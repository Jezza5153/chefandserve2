/**
 * In-app notifications — PR-CHEF-0.
 *
 * The `notifications` table is the BELL-AND-LIST inbox for chef/klant/admin
 * AND the future source for Web Push (PR-CHEF-15).
 *
 * Rules:
 *   - createNotification() is called by every business action that needs a
 *     user to know something. Pairs naturally with sendEmail() but is its
 *     own channel.
 *   - markRead() requires ownership (the auth lookup, not form data).
 *   - getUnreadCount() is cached briefly in the layout so the bell badge
 *     doesn't burn a query per page nav.
 */

import { and, desc, eq, isNull, lt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";

export type CreateNotificationArgs = {
  userId: string;
  /** Stable type key (see WORKFLOW.md §4.2 for the catalogue). */
  type: string;
  title: string;
  body?: string;
  /** Where the bell click should send the user. */
  actionUrl?: string;
  entityType?: string;
  entityId?: string;
};

/**
 * Insert one notification row. Best-effort: failures are logged but
 * never throw, because notifications are secondary to the business
 * mutation. If the bell misses one, the email is the safety net.
 */
export async function createNotification(
  args: CreateNotificationArgs,
): Promise<{ ok: boolean; id?: string }> {
  try {
    const [row] = await db
      .insert(notifications)
      .values({
        userId: args.userId,
        type: args.type,
        title: args.title,
        body: args.body,
        actionUrl: args.actionUrl,
        entityType: args.entityType,
        entityId: args.entityId,
      })
      .returning({ id: notifications.id });
    return { ok: true, id: row.id };
  } catch (err) {
    console.error(
      "[notifications] create failed:",
      err instanceof Error ? err.message : "unknown",
      args,
    );
    return { ok: false };
  }
}

/**
 * Insert one notification PER recipient. Used when an event fans out to a
 * routable list (e.g. all super_admins on a privacy request).
 */
export async function createNotificationsFanOut(
  userIds: string[],
  shared: Omit<CreateNotificationArgs, "userId">,
): Promise<void> {
  if (userIds.length === 0) return;
  await db
    .insert(notifications)
    .values(userIds.map((userId) => ({ ...shared, userId })))
    .catch((err) => {
      console.error(
        "[notifications] fan-out failed:",
        err instanceof Error ? err.message : "unknown",
      );
    });
}

/**
 * Bell-badge query — counts unread for the session user. Cheap thanks to
 * the (userId, readAt, createdAt) index. Caller should cache for ~5s in
 * the layout to avoid hammering on every page render.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(eq(notifications.userId, userId), isNull(notifications.readAt)),
    );
  return rows.length;
}

/** Recent N notifications for the inbox drawer. */
export async function listRecent(
  userId: string,
  limit: number = 20,
): Promise<typeof notifications.$inferSelect[]> {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

/**
 * Mark one notification read. The userId check IS the auth — caller passes
 * session.user.id; we will only flip rows belonging to that user.
 */
export async function markRead(args: {
  notificationId: string;
  userId: string;
}): Promise<boolean> {
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, args.notificationId),
        eq(notifications.userId, args.userId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return updated.length === 1;
}

/** Bulk "markeer alles gelezen" — limited to the caller's own rows. */
export async function markAllRead(userId: string): Promise<number> {
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(eq(notifications.userId, userId), isNull(notifications.readAt)),
    )
    .returning({ id: notifications.id });
  return updated.length;
}

/** Retention — called from workers/retention.ts. */
export async function pruneOld(olderThanDays: number = 90): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await db
    .delete(notifications)
    .where(lt(notifications.createdAt, cutoff))
    .returning({ id: notifications.id });
  return result.length;
}
