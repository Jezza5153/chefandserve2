/**
 * Owner memory — facts/preferences Maarten tells the assistant to remember
 * (memory.remember / list / forget), AND injected into the system prompt every turn so
 * the assistant actually USES them. This is the "smarter over time" lever the owner can
 * fill himself (vs the curated playbook).
 *
 * Stored as a jsonb bag under the 'owner_memory' key in the existing business_settings
 * table — NO migration, ships live. Single-owner usage; mutations via withTx + upsert.
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { withTx } from "@/lib/db/tx";
import { businessSettings } from "@/lib/db/schema";

const KEY = "owner_memory";

export type MemoryFact = { id: string; userId: string; text: string; createdAt: string };

type Bag = { items: MemoryFact[] };

function readBag(value: unknown): Bag {
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return value as Bag;
  }
  return { items: [] };
}

export async function listOwnerMemory(userId: string): Promise<MemoryFact[]> {
  const [row] = await db
    .select({ value: businessSettings.value })
    .from(businessSettings)
    .where(eq(businessSettings.key, KEY))
    .limit(1);
  return readBag(row?.value)
    .items.filter((f) => f.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function rememberFact(args: {
  userId: string;
  text: string;
  id: string;
  now: string;
}): Promise<MemoryFact> {
  const fact: MemoryFact = { id: args.id, userId: args.userId, text: args.text, createdAt: args.now };
  await withTx(async (tx) => {
    const [row] = await tx
      .select({ value: businessSettings.value })
      .from(businessSettings)
      .where(eq(businessSettings.key, KEY))
      .limit(1);
    const bag = readBag(row?.value);
    bag.items.push(fact);
    await tx
      .insert(businessSettings)
      .values({ key: KEY, value: bag, updatedBy: args.userId })
      .onConflictDoUpdate({
        target: businessSettings.key,
        set: { value: bag, updatedBy: args.userId, updatedAt: new Date() },
      });
  });
  return fact;
}

export async function forgetFact(args: { userId: string; id: string }): Promise<boolean> {
  let changed = false;
  await withTx(async (tx) => {
    const [row] = await tx
      .select({ value: businessSettings.value })
      .from(businessSettings)
      .where(eq(businessSettings.key, KEY))
      .limit(1);
    const bag = readBag(row?.value);
    const before = bag.items.length;
    bag.items = bag.items.filter((f) => !(f.id === args.id && f.userId === args.userId));
    changed = bag.items.length < before;
    if (changed) {
      await tx
        .update(businessSettings)
        .set({ value: bag, updatedAt: new Date() })
        .where(eq(businessSettings.key, KEY));
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
