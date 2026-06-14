/**
 * /client/notifications — klant in-app inbox (PR-CHEF-9) + mail-voorkeuren (PR-K2-7).
 */

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { NotificationsPage } from "@/components/NotificationsPage";
import { PushOptIn } from "@/components/chef/PushOptIn";
import { db } from "@/lib/db/client";
import { notificationPrefs } from "@/lib/db/schema";
import { CLIENT_NOTIFICATION_PREFS } from "@/lib/domain/client-recipients";
import { subscribePush } from "@/lib/domain/push-subscriptions";
import { env } from "@/lib/env";
import { getUnreadCount, listRecent, markAllRead, markRead } from "@/lib/integrations";
import { setPref } from "@/lib/integrations/prefs";
import { requireAuth } from "@/lib/permissions";

import { ClientNotificationPrefs } from "./ClientNotificationPrefs";

export const metadata = { title: "Meldingen" };
export const dynamic = "force-dynamic";

async function markReadAction(formData: FormData) {
  "use server";
  const session = await requireAuth();
  const id = String(formData.get("notificationId") ?? "");
  if (!id) return;
  await markRead({ notificationId: id, userId: session.user.id });
  revalidatePath("/client/notifications");
  revalidatePath("/client");
}

async function markAllReadAction() {
  "use server";
  const session = await requireAuth();
  await markAllRead(session.user.id);
  revalidatePath("/client/notifications");
  revalidatePath("/client");
}

async function savePrefsAction(formData: FormData) {
  "use server";
  const session = await requireAuth();
  // Auth IS the lookup — prefs are keyed by the session user only. setPref is an
  // idempotent upsert of immutable boolean values, so a double-submit/replay is
  // harmless (no nonce needed).
  for (const { event } of CLIENT_NOTIFICATION_PREFS) {
    const enabled = formData.get(`pref_${event}`) === "on";
    await setPref({ userId: session.user.id, eventKey: event, enabled });
  }
  revalidatePath("/client/notifications");
}

async function subscribePushAction(sub: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
}) {
  "use server";
  const session = await requireAuth();
  await subscribePush({ userId: session.user.id, ...sub });
}

export default async function ClientNotificationsPage() {
  const session = await requireAuth("/client/notifications");
  const [rows, unreadCount, prefRow] = await Promise.all([
    listRecent(session.user.id, 50),
    getUnreadCount(session.user.id),
    db
      .select({ prefs: notificationPrefs.prefs })
      .from(notificationPrefs)
      .where(eq(notificationPrefs.userId, session.user.id))
      .limit(1),
  ]);

  const stored = (prefRow[0]?.prefs ?? {}) as Record<string, boolean>;
  const current: Record<string, boolean> = {};
  for (const { event } of CLIENT_NOTIFICATION_PREFS) {
    current[event] = stored[event] !== false; // default on (V1 always-on)
  }

  const vapidKey =
    env.WEB_PUSH_ENABLED === "true" && env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      ? env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      : null;

  return (
    <>
      {vapidKey ? (
        <PushOptIn
          vapidKey={vapidKey}
          subscribeAction={subscribePushAction}
          idleText="Zet meldingen aan en je krijgt een seintje op je telefoon zodra een chef is bevestigd of er uren klaarstaan om te tekenen."
          grantedText="✓ Meldingen staan aan. Je krijgt een seintje op je telefoon bij een bevestigde chef of uren die je moet tekenen."
        />
      ) : null}
      <NotificationsPage
        rows={rows}
        markReadAction={markReadAction}
        markAllReadAction={markAllReadAction}
        unreadCount={unreadCount}
      />
      <ClientNotificationPrefs
        categories={CLIENT_NOTIFICATION_PREFS.map((c) => ({
          event: c.event,
          label: c.label,
          description: c.description,
        }))}
        current={current}
        saveAction={savePrefsAction}
      />
    </>
  );
}
