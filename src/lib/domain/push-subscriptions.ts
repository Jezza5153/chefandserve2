/**
 * Web Push subscriptions (CHEF-14). Auth IS the lookup — userId always comes
 * from the session, never form data. endpoint is globally unique (one row per
 * browser); re-subscribe upserts + self-heals failureCount/disabledAt.
 */
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { pushSubscriptions, type PushSubscriptionRow } from "@/lib/db/schema";

export async function subscribePush(args: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({
      userId: args.userId,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      userAgent: args.userAgent ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId: args.userId,
        p256dh: args.p256dh,
        auth: args.auth,
        userAgent: args.userAgent ?? null,
        lastSeenAt: new Date(),
        failureCount: 0,
        disabledAt: null,
      },
    });
}

export async function unsubscribePush(args: { userId: string; endpoint: string }): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, args.userId), eq(pushSubscriptions.endpoint, args.endpoint)));
}

export async function listActiveSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
  return db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.disabledAt)));
}

/** A dead endpoint (410 Gone / 404) — the browser unsubscribed. Drop the row. */
export async function pruneDeadSubscription(endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.disabledAt)))
    .limit(1);
  return rows.length > 0;
}
