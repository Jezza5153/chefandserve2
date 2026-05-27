/**
 * NotificationBell — PR-CHEF-9.
 *
 * Server component used in chef/klant/admin layouts.
 * Shows the bell icon with an unread-count badge linking to /notifications.
 * Single cheap query (indexed on userId+readAt).
 */

import Link from "next/link";

import { getUnreadCount } from "@/lib/integrations";

export async function NotificationBell({
  userId,
  notificationsHref,
}: {
  userId: string;
  notificationsHref: string;
}) {
  const count = await getUnreadCount(userId);
  return (
    <Link
      href={notificationsHref}
      aria-label={`Meldingen${count > 0 ? ` — ${count} ongelezen` : ""}`}
      className="relative inline-flex items-center"
    >
      <span aria-hidden className="text-lg leading-none">🔔</span>
      {count > 0 ? (
        <span className="ml-1 inline-flex min-w-[20px] items-center justify-center rounded-full bg-burgundy px-1.5 py-0.5 font-ui text-[10px] font-medium leading-none text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
