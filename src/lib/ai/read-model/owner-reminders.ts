/**
 * Owner personal reminders — Maarten's own "to-remember" list, surfaced via the assistant
 * (reminders.create / list / complete).
 *
 * Stored as a jsonb bag under the 'owner_reminders' key in the existing business_settings
 * KV table, so this needs NO migration and ships live. Single-owner usage → no contention;
 * mutations still go through withTx + an atomic upsert. Namespaced by userId so it stays
 * correct if more than one internal user ever uses it.
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { withTx } from "@/lib/db/tx";
import { businessSettings } from "@/lib/db/schema";

const KEY = "owner_reminders";

export type OwnerReminder = {
  id: string;
  userId: string;
  body: string;
  /** ISO timestamp, or null for an undated note. */
  dueAt: string | null;
  done: boolean;
  createdAt: string;
  completedAt: string | null;
};

type Bag = { items: OwnerReminder[] };

function readBag(value: unknown): Bag {
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return value as Bag;
  }
  return { items: [] };
}

export async function listOwnerReminders(
  userId: string,
  opts?: { includeDone?: boolean },
): Promise<OwnerReminder[]> {
  const [row] = await db
    .select({ value: businessSettings.value })
    .from(businessSettings)
    .where(eq(businessSettings.key, KEY))
    .limit(1);
  const mine = readBag(row?.value).items.filter((r) => r.userId === userId);
  const items = opts?.includeDone ? mine : mine.filter((r) => !r.done);
  return items.sort(
    (a, b) =>
      (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

export async function createOwnerReminder(args: {
  userId: string;
  body: string;
  dueAt: string | null;
  id: string;
  now: string;
}): Promise<OwnerReminder> {
  const reminder: OwnerReminder = {
    id: args.id,
    userId: args.userId,
    body: args.body,
    dueAt: args.dueAt,
    done: false,
    createdAt: args.now,
    completedAt: null,
  };
  await withTx(async (tx) => {
    const [row] = await tx
      .select({ value: businessSettings.value })
      .from(businessSettings)
      .where(eq(businessSettings.key, KEY))
      .limit(1);
    const bag = readBag(row?.value);
    bag.items.push(reminder);
    await tx
      .insert(businessSettings)
      .values({ key: KEY, value: bag, updatedBy: args.userId })
      .onConflictDoUpdate({
        target: businessSettings.key,
        set: { value: bag, updatedBy: args.userId, updatedAt: new Date() },
      });
  });
  return reminder;
}

export async function completeOwnerReminder(args: {
  userId: string;
  id: string;
  now: string;
}): Promise<boolean> {
  let changed = false;
  await withTx(async (tx) => {
    const [row] = await tx
      .select({ value: businessSettings.value })
      .from(businessSettings)
      .where(eq(businessSettings.key, KEY))
      .limit(1);
    const bag = readBag(row?.value);
    const item = bag.items.find((r) => r.id === args.id && r.userId === args.userId);
    if (!item || item.done) return;
    item.done = true;
    item.completedAt = args.now;
    changed = true;
    await tx
      .update(businessSettings)
      .set({ value: bag, updatedAt: new Date() })
      .where(eq(businessSettings.key, KEY));
  });
  return changed;
}
