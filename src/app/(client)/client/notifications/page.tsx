/**
 * /client/notifications — klant in-app inbox (PR-CHEF-9).
 */

import { revalidatePath } from "next/cache";

import { NotificationsPage } from "@/components/NotificationsPage";
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

export default async function ClientNotificationsPage() {
  const session = await requireAuth("/client/notifications");
  const [rows, unreadCount] = await Promise.all([
    listRecent(session.user.id, 50),
    getUnreadCount(session.user.id),
  ]);
  return (
    <NotificationsPage
      rows={rows}
      markReadAction={markReadAction}
      markAllReadAction={markAllReadAction}
      unreadCount={unreadCount}
    />
  );
}
