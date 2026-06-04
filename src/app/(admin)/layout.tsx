import type { Metadata } from "next";
import Link from "next/link";

import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
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
  const roleLabel = session.user.roles.includes("owner")
    ? "Eigenaar"
    : session.user.roles.includes("super_admin")
      ? "Beheerder"
      : session.user.roles.includes("planner")
        ? "Planner"
        : session.user.roles.join(", ");

  return (
    <div className="flex min-h-screen bg-bg-gray">
      <aside className="hidden w-60 shrink-0 border-r border-ink-200 bg-white md:flex md:flex-col">
        <div className="px-6 py-6">
          <Link
            href="/admin"
            className="font-serif text-xl uppercase tracking-wide leading-none text-burgundy"
          >
            Chef&nbsp;&amp;&nbsp;Serve
          </Link>
        </div>

        <SidebarNav roles={session.user.roles} />

        <div className="space-y-1 border-t border-ink-200 px-3 py-4">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-ink-200 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-[13px] text-ink-900">
                {session.user.name ?? session.user.email}
              </p>
              <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
                {roleLabel}
              </p>
            </div>
            <NotificationBell
              userId={session.user.id}
              notificationsHref="/admin/notifications"
            />
          </div>
          <SignOutLink />
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto">
        <ImpersonationBanner session={session} />
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
