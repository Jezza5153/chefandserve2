import Link from "next/link";
import { navigation, site } from "@/lib/site";

export function Header() {
  return (
    <>
      {/* Top contact strip */}
      <div className="bg-burgundy text-xs text-white">
        <div className="mx-auto flex max-w-container items-center justify-between px-4 py-2">
          <span className="hidden sm:inline">
            SERVING THE PEOPLE, MAKING THE MOMENT.
          </span>
          <a
            href={`tel:${site.phone}`}
            className="ml-auto inline-flex items-center gap-2 hover:underline"
          >
            <span aria-hidden>📞</span>
            {site.phoneDisplay}
          </a>
        </div>
      </div>

      {/* Main header */}
      <header className="border-b border-gray-100 bg-white">
        <div className="mx-auto flex max-w-container items-center justify-between px-4 py-4">
          <Link href="/" className="font-serif text-xl text-ink-900 md:text-2xl">
            <span className="tracking-wide">Chef &amp; Serve</span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm md:flex" aria-label="Hoofdmenu">
            {navigation.main.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="font-medium uppercase tracking-wide text-ink-700 hover:text-burgundy"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <Link
            href="/contact-us/"
            className="rounded border border-ink-900 px-4 py-2 text-sm font-medium uppercase tracking-wide text-ink-900 transition-colors hover:bg-burgundy hover:border-burgundy hover:text-white"
          >
            Shift manager
          </Link>
        </div>
      </header>
    </>
  );
}
