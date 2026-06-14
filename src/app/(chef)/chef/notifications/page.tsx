/**
 * /chef/notifications — chef in-app inbox (PR-CHEF-9).
 */

import { revalidatePath } from "next/cache";

import { NotificationsPage } from "@/components/NotificationsPage";
import { PushOptIn } from "@/components/chef/PushOptIn";
import { subscribePush } from "@/lib/domain/push-subscriptions";
import { env } from "@/lib/env";
import { getUnreadCount, listRecent, markAllRead, markRead } from "@/lib/integrations";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Meldingen" };
export const dynamic = "force-dynamic";

async function markReadAction(formData: FormData) {
  "use server";
  const session = await requireAuth();
  const id = String(formData.get("notificationId") ?? "");
  if (!id) return;
  await markRead({ notificationId: id, userId: session.user.id });
  revalidatePath("/chef/notifications");
  revalidatePath("/chef");
}

async function markAllReadAction() {
  "use server";
  const session = await requireAuth();
  await markAllRead(session.user.id);
  revalidatePath("/chef/notifications");
  revalidatePath("/chef");
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

export default async function ChefNotificationsPage() {
  const session = await requireAuth("/chef/notifications");
  const [rows, unreadCount] = await Promise.all([
    listRecent(session.user.id, 50),
    getUnreadCount(session.user.id),
  ]);
  const vapidKey =
    env.WEB_PUSH_ENABLED === "true" && env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      ? env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      : null;
  return (
    <>
      {vapidKey ? <PushOptIn vapidKey={vapidKey} subscribeAction={subscribePushAction} /> : null}
      <NotificationsPage
        rows={rows}
        markReadAction={markReadAction}
        markAllReadAction={markAllReadAction}
        unreadCount={unreadCount}
      />
    </>
  );
}
