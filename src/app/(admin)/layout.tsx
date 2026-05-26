import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/site";

/**
 * Admin layout — minimal shell stub.
 *
 * Phase 0 (PR-0B): basic two-column shell with hardcoded placeholder nav.
 * PR-0F replaces the sidebar with a real role-aware SidebarNav component
 * that reads roles from the session.
 *
 * No auth check at this layer — middleware handles unauthed redirects.
 */
export const metadata: Metadata = {
  title: {
    default: "Admin",
    template: `%s · ${site.name} Admin`,
  },
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-bg-gray">
      {/* Sidebar — placeholder. PR-0F renders real role-aware nav here. */}
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

        <nav className="flex-1 px-3 py-6" aria-label="Admin navigation">
          <p className="px-3 font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
            Phase 0
          </p>
          <ul className="mt-2 space-y-1">
            <li>
              <Link
                href="/admin"
                className="block rounded px-3 py-2 font-ui text-sm text-ink-900 hover:bg-burgundy/5 hover:text-burgundy"
              >
                Dashboard
              </Link>
            </li>
          </ul>

          <p className="mt-8 px-3 font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
            Binnenkort
          </p>
          <ul className="mt-2 space-y-1">
            {[
              "Inbox",
              "Chefs",
              "Clients",
              "Shifts",
              "Roster",
              "Hours",
              "Errors",
              "Audit",
              "Users",
              "Roles",
            ].map((label) => (
              <li
                key={label}
                className="flex items-center justify-between rounded px-3 py-2 font-ui text-sm text-ink-500"
              >
                <span>{label}</span>
                <span className="rounded-full bg-burgundy/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-burgundy">
                  Binnenkort
                </span>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-ink-200 px-6 py-4">
          <Link
            href="/login"
            className="font-ui text-[11px] uppercase tracking-[0.18em] text-ink-700 hover:text-burgundy"
          >
            ← Uitloggen
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-x-auto">
        <header className="flex items-center justify-between border-b border-ink-200 bg-white px-6 py-4 md:hidden">
          <Link
            href="/admin"
            className="font-serif text-lg tracking-[0.04em] text-ink-900"
          >
            Chef <span className="text-burgundy">&amp;</span> Serve
          </Link>
          <Link
            href="/login"
            className="font-ui text-[11px] uppercase tracking-[0.18em] text-ink-700 hover:text-burgundy"
          >
            Uitloggen
          </Link>
        </header>

        <div className="px-6 py-10 md:px-10 md:py-12">{children}</div>
      </main>
    </div>
  );
}
