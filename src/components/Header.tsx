import Link from "next/link";
import { navigation, site } from "@/lib/site";

/**
 * Header — matches live site:
 *   1. Thin burgundy top strip (small caps tagline + phone)
 *   2. White nav row with real logo image (no text fallback), main nav, SHIFT MANAGER outline CTA
 */
export function Header() {
  return (
    <>
      {/* Top burgundy strip */}
      <div className="bg-burgundy text-[11px] tracking-[0.18em] text-cream">
        <div className="mx-auto flex max-w-container items-center justify-between px-4 py-1.5">
          <span className="hidden font-ui uppercase sm:inline">
            Serving the people, making the moment.
          </span>
          <a
            href={`tel:${site.phone}`}
            className="ml-auto font-ui uppercase transition-opacity hover:opacity-80"
          >
            {site.phoneDisplay}
          </a>
        </div>
      </div>

      {/* Main nav */}
      <header className="bg-white">
        <div className="mx-auto flex max-w-container items-center justify-between gap-6 px-4 py-5 lg:py-6">
          {/* Wordmark — matches live site (Prata serif "CHEF & SERVE") */}
          <Link
            href="/"
            aria-label={site.name}
            className="font-serif text-2xl tracking-[0.04em] text-ink-900 md:text-3xl"
          >
            Chef <span className="text-burgundy">&amp;</span> Serve
          </Link>

          {/* Main nav */}
          <nav
            className="hidden flex-1 items-center justify-center gap-8 lg:flex"
            aria-label="Hoofdmenu"
          >
            {navigation.main.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="font-ui text-[11px] uppercase tracking-[0.18em] text-ink-900 transition-colors hover:text-burgundy"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* CTA + utility */}
          <div className="flex shrink-0 items-center gap-3">
            <a
              href={`tel:${site.phone}`}
              aria-label="Bel ons"
              className="hidden h-9 w-9 items-center justify-center rounded-full border border-ink-900 text-ink-900 transition-colors hover:bg-burgundy hover:border-burgundy hover:text-white md:inline-flex"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </a>

            <Link
              href="/work-with-us/"
              className="hidden rounded-full border border-ink-900 px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-900 transition-colors hover:border-burgundy hover:bg-burgundy hover:text-white md:inline-block"
            >
              Shift manager
            </Link>
          </div>
        </div>
      </header>
    </>
  );
}
