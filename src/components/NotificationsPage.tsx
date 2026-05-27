/**
 * NotificationsPage — PR-CHEF-9.
 *
 * Shared body for /chef/notifications + /client/notifications +
 * /admin/notifications. Lists recent notifications with mark-as-read action.
 *
 * The mark-read server action must come from the caller (route page) since
 * server actions live with their pages.
 */

import Link from "next/link";

import type { Notification } from "@/lib/db/schema";

export function NotificationsPage({
  rows,
  markReadAction,
  markAllReadAction,
  unreadCount,
}: {
  rows: Notification[];
  markReadAction: (formData: FormData) => Promise<void> | void;
  markAllReadAction: (formData: FormData) => Promise<void> | void;
  unreadCount: number;
}) {
  const unread = rows.filter((r) => r.readAt === null);
  const read = rows.filter((r) => r.readAt !== null);

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Meldingen
      </p>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <h1 className="font-serif text-3xl text-ink-900 md:text-4xl">
          {unreadCount > 0 ? `${unreadCount} nieuw` : "Geen nieuwe meldingen"}
        </h1>
        {unreadCount > 0 ? (
          <form action={markAllReadAction}>
            <button
              type="submit"
              className="rounded-full border border-burgundy/40 bg-white px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5"
            >
              Markeer alles gelezen
            </button>
          </form>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="mt-10 rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          Geen meldingen — alles is bijgewerkt.
        </p>
      ) : (
        <div className="mt-8 space-y-6">
          {unread.length > 0 ? (
            <section>
              <h2 className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
                Ongelezen
              </h2>
              <ul className="mt-2 space-y-2">
                {unread.map((n) => (
                  <NotificationRow
                    key={n.id}
                    n={n}
                    markReadAction={markReadAction}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {read.length > 0 ? (
            <section>
              <h2 className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
                Eerder
              </h2>
              <ul className="mt-2 space-y-1">
                {read.map((n) => (
                  <NotificationRow
                    key={n.id}
                    n={n}
                    markReadAction={markReadAction}
                    muted
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  n,
  markReadAction,
  muted,
}: {
  n: Notification;
  markReadAction: (formData: FormData) => Promise<void> | void;
  muted?: boolean;
}) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className={muted ? "text-sm text-ink-500" : "font-serif text-base text-ink-900"}>
          {n.title}
        </p>
        {n.body ? (
          <p className={muted ? "text-xs text-ink-500" : "mt-0.5 text-sm text-ink-700"}>
            {n.body}
          </p>
        ) : null}
        <p className="mt-1 text-[11px] text-ink-500">
          {timeAgo(n.createdAt)}
        </p>
      </div>
    </>
  );

  const cls = muted
    ? "flex items-center justify-between gap-3 rounded border border-ink-200 bg-white px-4 py-2"
    : "flex items-center justify-between gap-3 rounded-lg border-2 border-burgundy/30 bg-burgundy/5 p-4";

  if (n.actionUrl) {
    return (
      <li className={cls}>
        <Link href={n.actionUrl} className="block min-w-0 flex-1">
          {body}
        </Link>
        {!muted ? (
          <form action={markReadAction}>
            <input type="hidden" name="notificationId" value={n.id} />
            <button
              type="submit"
              className="shrink-0 rounded-full bg-burgundy px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900"
            >
              Open →
            </button>
          </form>
        ) : null}
      </li>
    );
  }

  return (
    <li className={cls}>
      {body}
      {!muted ? (
        <form action={markReadAction}>
          <input type="hidden" name="notificationId" value={n.id} />
          <button
            type="submit"
            className="shrink-0 rounded-full border border-burgundy/40 bg-white px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5"
          >
            Gelezen
          </button>
        </form>
      ) : null}
    </li>
  );
}

function timeAgo(d: Date | string): string {
  const ms = Date.now() - new Date(d).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "zojuist";
  if (min < 60) return `${min} min geleden`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} u geleden`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} d geleden`;
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
