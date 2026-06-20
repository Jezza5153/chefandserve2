/**
 * Owner memory — facts/preferences Maarten tells the assistant to remember
 * (memory.remember / list / forget), AND injected into the system prompt every turn so
 * the assistant actually USES them. This is the "smarter over time" lever the owner can
 * fill himself (vs the curated playbook).
 *
 * Stored as a jsonb bag in the existing business_settings table — NO migration, ships live.
 *
 * PER-USER ROWS (audit gap #5): each user's facts live under their OWN key `owner_memory:<userId>`,
 * not one shared `owner_memory` bag. The old shared design meant two owners/planners writing at once
 * lost-updated each other (withTx reads, mutates in JS, writes back — no row lock), and one corrupt
 * row wiped EVERYONE. Per-user rows remove the cross-user contention and shrink the corruption blast
 * radius to a single user. Migration is LAZY + zero-downtime: reads fall back to the legacy shared
 * row (filtered to the user) until their first write persists them to their own row.
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { withTx, type TxConn } from "@/lib/db/tx";
import { businessSettings } from "@/lib/db/schema";

/** Legacy shared row — read-only fallback now; never written to again (lazy migration drains it). */
const LEGACY_KEY = "owner_memory";
const keyFor = (userId: string) => `${LEGACY_KEY}:${userId}`;
/** Cap per user — every fact is injected into EVERY turn's context, so unbounded growth would
 *  silently bloat tokens. Oldest facts fall off when the cap is hit (the assistant tells Maarten). */
export const MEMORY_CAP = 50;

export type MemoryFact = { id: string; userId: string; text: string; createdAt: string };

/** Normalize for dedup: lowercase, collapse whitespace, strip trailing punctuation.
 *  Exported for the memory-mining worker (dedup proposals against existing facts). */
export const normalizeFactText = (s: string) =>
  s.toLowerCase().replace(/\s+/g, " ").replace(/[.!?\s]+$/, "").trim();
const normalize = normalizeFactText;

type Bag = { items: MemoryFact[] };

function readBag(value: unknown): Bag {
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return value as Bag;
  }
  return { items: [] };
}

type Conn = typeof db | TxConn;
const valueByKey = async (conn: Conn, key: string): Promise<unknown> => {
  const [row] = await conn.select({ value: businessSettings.value }).from(businessSettings).where(eq(businessSettings.key, key)).limit(1);
  return row?.value;
};

/** This user's bag: their OWN per-user row when it exists (so forgotten facts stay forgotten),
 *  else a one-time view of the legacy shared row filtered to their items — read inside the SAME
 *  connection/tx as the caller so a mutation sees a consistent snapshot. The first write persists
 *  the user to `owner_memory:<userId>`, completing their lazy migration. `hasOwn` distinguishes an
 *  empty-but-existing per-user row (all facts forgotten) from a not-yet-migrated user. */
async function loadUserBag(conn: Conn, userId: string): Promise<{ bag: Bag; hasOwn: boolean }> {
  const [own] = await conn
    .select({ value: businessSettings.value })
    .from(businessSettings)
    .where(eq(businessSettings.key, keyFor(userId)))
    .limit(1);
  if (own) return { bag: readBag(own.value), hasOwn: true };
  const legacy = await valueByKey(conn, LEGACY_KEY);
  return { bag: { items: readBag(legacy).items.filter((f) => f.userId === userId) }, hasOwn: false };
}

export async function listOwnerMemory(userId: string): Promise<MemoryFact[]> {
  const { bag } = await loadUserBag(db, userId);
  return bag.items
    .filter((f) => f.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export type RememberResult = {
  fact: MemoryFact;
  /** True when an existing fact matched (refreshed in place — no duplicate stored). */
  deduped: boolean;
  /** Oldest facts dropped to stay under MEMORY_CAP (empty when under the cap). */
  evicted: MemoryFact[];
};

export async function rememberFact(args: {
  userId: string;
  text: string;
  id: string;
  now: string;
}): Promise<RememberResult> {
  const fact: MemoryFact = { id: args.id, userId: args.userId, text: args.text, createdAt: args.now };
  let deduped = false;
  let evicted: MemoryFact[] = [];
  await withTx(async (tx) => {
    const { bag } = await loadUserBag(tx, args.userId);

    // Dedup: same normalized text for this user → refresh the existing fact instead of duplicating.
    const norm = normalize(args.text);
    const existing = bag.items.find((f) => f.userId === args.userId && normalize(f.text) === norm);
    if (existing) {
      existing.text = args.text;
      existing.createdAt = args.now;
      deduped = true;
    } else {
      bag.items.push(fact);
      // Cap per user: evict the oldest facts beyond MEMORY_CAP.
      const mine = bag.items
        .filter((f) => f.userId === args.userId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      if (mine.length > MEMORY_CAP) {
        evicted = mine.slice(0, mine.length - MEMORY_CAP);
        const evictIds = new Set(evicted.map((f) => f.id));
        bag.items = bag.items.filter((f) => !evictIds.has(f.id));
      }
    }

    // Upsert THIS user's own row (it may not exist yet pre-migration → insert) — never the shared one.
    await tx
      .insert(businessSettings)
      .values({ key: keyFor(args.userId), value: bag, updatedBy: args.userId })
      .onConflictDoUpdate({
        target: businessSettings.key,
        set: { value: bag, updatedBy: args.userId, updatedAt: new Date() },
      });
  });
  return { fact: deduped ? { ...fact, id: "(bestaand)" } : fact, deduped, evicted };
}

export async function forgetFact(args: { userId: string; id: string }): Promise<boolean> {
  let changed = false;
  await withTx(async (tx) => {
    const { bag } = await loadUserBag(tx, args.userId);
    const before = bag.items.length;
    bag.items = bag.items.filter((f) => !(f.id === args.id && f.userId === args.userId));
    changed = bag.items.length < before;
    if (changed) {
      // Upsert (not update): the per-user row may not exist yet if this is the user's first mutation
      // after the split — the forget would otherwise silently not persist against the legacy view.
      await tx
        .insert(businessSettings)
        .values({ key: keyFor(args.userId), value: bag, updatedBy: args.userId })
        .onConflictDoUpdate({
          target: businessSettings.key,
          set: { value: bag, updatedBy: args.userId, updatedAt: new Date() },
        });
    }
  });
  return changed;
}

/** Compact block appended to the system prompt so the assistant always knows these facts.
 *  Empty string when there's nothing remembered (or on any error — best-effort). */
export async function ownerMemoryPromptBlock(userId: string): Promise<string> {
  try {
    const facts = await listOwnerMemory(userId);
    if (facts.length === 0) return "";
    const lines = facts.map((f) => `- ${f.text}`).join("\n");
    return `\n\n## Wat Maarten je heeft laten onthouden\n${lines}`;
  } catch {
    return "";
  }
}
