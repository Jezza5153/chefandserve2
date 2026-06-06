/**
 * /admin/notifications — admin in-app inbox (PR-CHEF-9).
 */

import { revalidatePath } from "next/cache";

import { NotificationsPage } from "@/components/NotificationsPage";
import { getUnreadCount, listRecent, markAllRead, markRead } from "@/lib/integrations";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Meldingen", robots: { index: false } };
export const dynamic = "force-dynamic";

async function markReadAction(formData: FormData) {
  "use server";
  const session = await requirePermission("notifications", "read");
  const id = String(formData.get("notificationId") ?? "");
  if (!id) return;
  await markRead({ notificationId: id, userId: session.user.id });
  revalidatePath("/admin/notifications");
  revalidatePath("/admin/business");
}

async function markAllReadAction() {
  "use server";
  const session = await requirePermission("notifications", "read");
  await markAllRead(session.user.id);
  revalidatePath("/admin/notifications");
  revalidatePath("/admin/business");
}

export default async function AdminNotificationsPage() {
  const session = await requirePermission("notifications", "read");
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
