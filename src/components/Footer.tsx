import Image from "next/image";
import Link from "next/link";
import { navigation, site } from "@/lib/site";

export function Footer() {
  return (
    <footer className="bg-ink-900 text-white">
      <div className="mx-auto max-w-container px-4 py-20 md:py-24">
        <div className="grid gap-12 md:grid-cols-12">
          {/* Brand block */}
          <div className="md:col-span-5">
            <Link href="/" aria-label={site.name} className="inline-block">
              <Image
                src="/images/logo.svg"
                alt={`${site.name} logo`}
                width={170}
                height={48}
                className="h-12 w-auto brightness-0 invert"
              />
            </Link>
            <p className="mt-6 max-w-sm font-serif text-lg leading-relaxed text-white/80">
              Serving the people, making the moment.
            </p>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/60">
              Premium horeca uitzendbureau in Amsterdam. 100% loondienst, geen
              ZZP-risico, Wet DBA 2026 compliant.
            </p>
            <div className="mt-8 flex gap-4">
              {Object.entries(site.social).map(([name, url]) => (
                <a
                  key={name}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-ui text-[11px] uppercase tracking-[0.18em] text-white/60 transition-colors hover:text-cream"
                  aria-label={`${site.name} op ${name}`}
                >
                  {name === "linkedin"
                    ? "LinkedIn"
                    : name === "instagram"
                      ? "Instagram"
                      : name === "facebook"
                        ? "Facebook"
                        : "X"}
                </a>
              ))}
            </div>
          </div>

          {/* Diensten */}
          <div className="md:col-span-3">
            <p className="mb-5 font-ui text-[11px] uppercase tracking-[0.18em] text-cream">
              Diensten
            </p>
            <ul className="space-y-3 font-serif text-base">
              {navigation.services.slice(0, 6).map((s) => (
                <li key={s.href}>
                  <Link
                    href={s.href}
                    className="text-white/80 transition-colors hover:text-white"
                  >
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Bedrijf */}
          <div className="md:col-span-2">
            <p className="mb-5 font-ui text-[11px] uppercase tracking-[0.18em] text-cream">
              Bedrijf
            </p>
            <ul className="space-y-3 font-serif text-base">
              {navigation.main.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-white/80 transition-colors hover:text-white"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div className="md:col-span-2">
            <p className="mb-5 font-ui text-[11px] uppercase tracking-[0.18em] text-cream">
              Contact
            </p>
            <ul className="space-y-3 text-sm">
              <li>
                <a
                  href={`tel:${site.phone}`}
                  className="text-white/80 transition-colors hover:text-white"
                >
                  {site.phoneDisplay}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${site.email}`}
                  className="text-white/80 transition-colors hover:text-white"
                >
                  {site.email}
                </a>
              </li>
              <li className="text-white/60">
                {site.address.street}
                <br />
                {site.address.postalCode} {site.address.locality}
              </li>
              <li className="text-white/40">KvK {site.kvk}</li>
            </ul>
          </div>
        </div>

        {/* Bottom strip */}
        <div className="mt-16 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-8 text-xs text-white/50 md:flex-row md:items-center">
          <p>
            © {new Date().getFullYear()} {site.name}. Alle rechten voorbehouden.
          </p>
          <div className="flex gap-6">
            {navigation.footer.legal.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="transition-colors hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
