import type { Metadata } from "next";
import Link from "next/link";

import { NotificationBell } from "@/components/NotificationBell";
import { SidebarNav } from "@/components/admin/SidebarNav";
import { requireAuth } from "@/lib/permissions";
import { site } from "@/lib/site";

import { SignOutLink } from "./_components/SignOutLink";

export const metadata: Metadata = {
  title: {
    default: "Admin",
    template: `%s · ${site.name} Admin`,
  },
  robots: { index: false, follow: false },
};

/**
 * Admin shell. Requires auth. Sidebar adapts to session.user.roles.
 *
 * Middleware already redirects unauthed users to /login — this is a
 * second-layer defense in case middleware misses an edge case.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAuth();

  return (
    <div className="flex min-h-screen bg-bg-gray">
      <aside className="hidden w-64 shrink-0 border-r border-ink-200 bg-white md:flex md:flex-col">
        <div className="border-b border-ink-200 px-6 py-5">
          <Link
            href="/admin"
            className="font-serif text-xl tracking-[0.04em] text-ink-900"
          >
            Chef <span className="text-burgundy">&amp;</span> Serve
          </Link>
          <p className="mt-1 font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
            Operations
          </p>
        </div>

        <SidebarNav session={session} />

        <div className="border-t border-ink-200 px-6 py-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs leading-relaxed text-ink-700">
              <strong className="text-ink-900 block">
                {session.user.name ?? session.user.email}
              </strong>
              <span className="text-ink-500">
                {session.user.roles.join(", ")}
              </span>
            </p>
            <NotificationBell
              userId={session.user.id}
              notificationsHref="/admin/notifications"
            />
          </div>
          <SignOutLink />
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto">
        <header className="flex items-center justify-between border-b border-ink-200 bg-white px-6 py-4 md:hidden">
          <Link
            href="/admin"
            className="font-serif text-lg tracking-[0.04em] text-ink-900"
          >
            Chef <span className="text-burgundy">&amp;</span> Serve
          </Link>
          <div className="flex items-center gap-4">
            <NotificationBell
              userId={session.user.id}
              notificationsHref="/admin/notifications"
            />
            <SignOutLink />
          </div>
        </header>

        <div className="px-6 py-10 md:px-10 md:py-12">{children}</div>
      </main>
    </div>
  );
}
