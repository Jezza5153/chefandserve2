import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/site";

/**
 * Auth layout — minimal, no marketing Header/Footer.
 *
 * Used by /login, /verify and any other unauthenticated app surface.
 * Centered card on a soft burgundy background.
 */
export const metadata: Metadata = {
  title: {
    default: "Chef & Serve App",
    template: `%s · ${site.name}`,
  },
  robots: { index: false, follow: false },
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-burgundy/5">
      <header className="border-b border-burgundy/10 bg-white">
        <div className="mx-auto flex max-w-container items-center justify-between px-4 py-5">
          <Link
            href="/"
            className="font-serif text-xl tracking-[0.04em] text-ink-900 md:text-2xl"
          >
            Chef <span className="text-burgundy">&amp;</span> Serve
          </Link>
          <span className="font-ui text-[11px] uppercase tracking-[0.18em] text-ink-700">
            Operations
          </span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-16">
        {children}
      </main>

      <footer className="border-t border-burgundy/10 bg-white">
        <div className="mx-auto max-w-container px-4 py-4 text-center font-ui text-[11px] uppercase tracking-[0.18em] text-ink-500">
          © {new Date().getFullYear()} {site.name} · Closed system
        </div>
      </footer>
    </div>
  );
}
