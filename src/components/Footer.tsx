import Link from "next/link";
import { navigation, site } from "@/lib/site";

export function Footer() {
  return (
    <footer className="mt-section-y border-t border-gray-100 bg-ink-900 text-white">
      <div className="mx-auto max-w-container px-4 py-12">
        <div className="grid gap-8 md:grid-cols-4">
          {/* Brand block */}
          <div className="md:col-span-2">
            <Link href="/" className="font-serif text-2xl text-white">
              Chef &amp; Serve
            </Link>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-gray-300">
              Premium horeca uitzendbureau in Amsterdam.
              <br />
              100% loondienst. Geen ZZP-risico. Wet DBA 2026 compliant.
            </p>
            <p className="mt-4 text-xs text-gray-400">
              KvK {site.kvk} &middot; {site.address.street}, {site.address.postalCode}{" "}
              {site.address.locality}
            </p>
          </div>

          {/* Services */}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white">
              Diensten
            </h3>
            <ul className="space-y-2 text-sm">
              {navigation.services.slice(0, 6).map((s) => (
                <li key={s.href}>
                  <Link
                    href={s.href}
                    className="text-gray-300 underline-offset-4 hover:text-white hover:underline"
                  >
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact + legal */}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white">
              Contact
            </h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li>
                <a href={`tel:${site.phone}`} className="hover:text-white">
                  {site.phoneDisplay}
                </a>
              </li>
              <li>
                <a href={`mailto:${site.email}`} className="hover:text-white">
                  {site.email}
                </a>
              </li>
              <li>{site.address.street}</li>
              <li>
                {site.address.postalCode} {site.address.locality}
              </li>
            </ul>

            <h3 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-white">
              Juridisch
            </h3>
            <ul className="space-y-2 text-sm">
              {navigation.footer.legal.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-gray-300 hover:text-white">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-gray-700 pt-6 text-xs text-gray-400 md:flex-row md:items-center">
          <p>
            © {new Date().getFullYear()} {site.name}. Built on trust. Driven by people.
          </p>
          <div className="flex gap-4">
            {Object.entries(site.social).map(([name, url]) => (
              <a
                key={name}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white"
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
      </div>
    </footer>
  );
}
