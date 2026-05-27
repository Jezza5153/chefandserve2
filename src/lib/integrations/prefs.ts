/**
 * Notification preferences — PR-CHEF-6.
 *
 * V1: every transactional email/notification is always-on. The seam exists
 * via this helper so V2 can ship a /chef/settings + /client/settings UI
 * without changing every call site.
 *
 * Usage at call sites (V2-ready):
 *   if (await shouldSendToUser(userId, 'hours_approved')) {
 *     await sendEmail(...)
 *   }
 *
 * Default behavior with no row: return true (always-on).
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { notificationPrefs } from "@/lib/db/schema";

export async function shouldSendToUser(
  userId: string,
  eventKey: string,
): Promise<boolean> {
  const [row] = await db
    .select({ prefs: notificationPrefs.prefs })
    .from(notificationPrefs)
    .where(eq(notificationPrefs.userId, userId))
    .limit(1);
  if (!row) return true;
  const prefs = (row.prefs ?? {}) as Record<string, boolean>;
  // Suppress only when explicitly false. undefined/true → send.
  return prefs[eventKey] !== false;
}

export async function setPref(args: {
  userId: string;
  eventKey: string;
  enabled: boolean;
}): Promise<void> {
  const [existing] = await db
    .select({ prefs: notificationPrefs.prefs })
    .from(notificationPrefs)
    .where(eq(notificationPrefs.userId, args.userId))
    .limit(1);
  const prefs = (existing?.prefs ?? {}) as Record<string, boolean>;
  prefs[args.eventKey] = args.enabled;
  await db
    .insert(notificationPrefs)
    .values({ userId: args.userId, prefs: prefs as never })
    .onConflictDoUpdate({
      target: notificationPrefs.userId,
      set: { prefs: prefs as never, updatedAt: new Date() },
    });
}
