import type { Metadata } from "next";
import Link from "next/link";

import { SignOutLink } from "@/app/(admin)/_components/SignOutLink";
import { requireAuth } from "@/lib/permissions";

export const metadata: Metadata = {
  title: { default: "Klant-portal", template: "%s · Chef & Serve" },
  robots: { index: false, follow: false },
};

/**
 * Client portal layout — for hotels/restaurants/catering managers.
 * Phase 6 shell: dashboard + upcoming bookings. Phase 6 polish adds
 * request flow + invoices + chef ratings.
 */
export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAuth();

  const nav = [
    { label: "Dashboard", href: "/client" },
    { label: "Komende shifts", href: "/client/shifts" },
    { label: "Nieuwe aanvraag", href: "/client/request" },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-bg-gray">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-4">
          <div className="flex items-center justify-between">
            <Link
              href="/client"
              className="font-serif text-xl tracking-[0.04em] text-ink-900"
            >
              Chef <span className="text-burgundy">&amp;</span> Serve
            </Link>
            <div className="text-right">
              <p className="font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
                {session.user.name ?? session.user.email}
              </p>
              <SignOutLink />
            </div>
          </div>
          <nav className="mt-4 flex flex-wrap gap-1">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="rounded-full px-3 py-1.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-ink-700 hover:bg-burgundy/10 hover:text-burgundy"
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-4 py-8">{children}</div>
      </main>
    </div>
  );
}
