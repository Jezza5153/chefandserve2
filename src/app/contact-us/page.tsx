import type { Metadata } from "next";
import { CTAButton } from "@/components/CTAButton";
import { JsonLd } from "@/components/JsonLd";
import { TrustBanner } from "@/components/TrustBanner";
import {
  breadcrumbNode,
  buildGraph,
  webpageNode,
} from "@/lib/schema";
import { site } from "@/lib/site";

const SLUG = "contact-us";
const TITLE = "Contact — Chef & Serve, Amsterdam";
const DESCRIPTION =
  "Neem direct contact op met Chef & Serve in Amsterdam. Mail, bel of vul het contactformulier in. Wij reageren binnen een uur tijdens werkdagen.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/${SLUG}/` },
};

export default function Page() {
  const url = `${site.url}/${SLUG}/`;

  const contactPageNode = {
    "@type": "ContactPage",
    "@id": `${url}#contactpage`,
    url,
    name: TITLE,
    description: DESCRIPTION,
    isPartOf: { "@id": `${site.url}/#website` },
    about: { "@id": `${site.url}/#organization` },
    inLanguage: site.locale,
    mainEntity: { "@id": `${site.url}/#organization` },
  };

  const pageGraph = buildGraph(
    webpageNode({ url, name: TITLE, description: DESCRIPTION }),
    contactPageNode,
    breadcrumbNode([
      { name: "Home", url: `${site.url}/` },
      { name: "Contact", url },
    ]),
  );

  return (
    <>
      <JsonLd data={pageGraph} />

      <article className="mx-auto max-w-container px-4 py-section-y-mobile md:py-section-y-tablet lg:py-section-y">
        <TrustBanner />

        <header className="mb-12">
          <h1 className="mb-6">Contact</h1>
          <p className="prose-cs text-lg">
            Personeel nodig? Een vraag over onze werkwijze? Of wilt u
            sollicteren? Bel, mail of stuur een bericht — wij reageren binnen
            een uur tijdens werkdagen.
          </p>
        </header>

        {/* Contact methods grid */}
        <section className="mb-12 grid gap-6 md:grid-cols-3">
          <div className="rounded border border-gray-200 bg-white p-6">
            <h2 className="mb-3 font-serif text-xl">Bel direct</h2>
            <p className="mb-4 text-sm text-ink-700">
              Het snelste antwoord. Maarten of het team neemt op tijdens
              kantooruren.
            </p>
            <a
              href={`tel:${site.phone}`}
              className="text-lg font-medium text-burgundy underline-offset-4 hover:underline"
            >
              {site.phoneDisplay}
            </a>
            {site.phoneAlternate && (
              <p className="mt-2 text-sm text-ink-700">
                Of:{" "}
                <a
                  href={`tel:${site.phoneAlternate}`}
                  className="text-burgundy underline-offset-4 hover:underline"
                >
                  {site.phoneAlternate}
                </a>
              </p>
            )}
          </div>

          <div className="rounded border border-gray-200 bg-white p-6">
            <h2 className="mb-3 font-serif text-xl">Mail ons</h2>
            <p className="mb-4 text-sm text-ink-700">
              Voor briefings, offertes en sollicitaties.
            </p>
            <a
              href={`mailto:${site.email}`}
              className="text-lg font-medium text-burgundy underline-offset-4 hover:underline"
            >
              {site.email}
            </a>
          </div>

          <div className="rounded border border-gray-200 bg-white p-6">
            <h2 className="mb-3 font-serif text-xl">Bezoek ons</h2>
            <p className="mb-4 text-sm text-ink-700">
              Liever op afspraak even langslopen?
            </p>
            <address className="not-italic text-sm text-ink-700">
              {site.address.street}<br />
              {site.address.postalCode} {site.address.locality}<br />
              {site.address.region}, Nederland
            </address>
            <a
              href={site.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-sm font-medium text-burgundy underline-offset-4 hover:underline"
            >
              Open in Google Maps →
            </a>
          </div>
        </section>

        {/* Contact form */}
        <section className="mb-12 rounded bg-bg-gray p-8 md:p-12">
          <h2 className="mb-2">Stuur een bericht</h2>
          <p className="mb-6 text-ink-700">
            Vul het formulier in en wij nemen binnen een uur contact op.
          </p>

          <form
            action={`mailto:${site.email}`}
            method="post"
            encType="text/plain"
            className="grid gap-4 md:grid-cols-2"
          >
            <div className="md:col-span-1">
              <label htmlFor="name" className="mb-2 block text-sm font-medium">
                Naam
              </label>
              <input
                type="text"
                id="name"
                name="name"
                required
                className="w-full rounded border border-gray-300 bg-white px-4 py-2 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
              />
            </div>

            <div className="md:col-span-1">
              <label htmlFor="company" className="mb-2 block text-sm font-medium">
                Bedrijf / Locatie
              </label>
              <input
                type="text"
                id="company"
                name="company"
                className="w-full rounded border border-gray-300 bg-white px-4 py-2 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
              />
            </div>

            <div className="md:col-span-1">
              <label htmlFor="email" className="mb-2 block text-sm font-medium">
                E-mail
              </label>
              <input
                type="email"
                id="email"
                name="email"
                required
                className="w-full rounded border border-gray-300 bg-white px-4 py-2 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
              />
            </div>

            <div className="md:col-span-1">
              <label htmlFor="phone" className="mb-2 block text-sm font-medium">
                Telefoon
              </label>
              <input
                type="tel"
                id="phone"
                name="phone"
                className="w-full rounded border border-gray-300 bg-white px-4 py-2 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="role" className="mb-2 block text-sm font-medium">
                Welke rol zoekt u? (optioneel)
              </label>
              <select
                id="role"
                name="role"
                className="w-full rounded border border-gray-300 bg-white px-4 py-2 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
              >
                <option value="">Maak een keuze...</option>
                <option value="chef">Chef / Sous chef / Chef de partie</option>
                <option value="kok">Kok / Commis / Keukenhulp</option>
                <option value="bediening">Bediening / Host / Runner</option>
                <option value="banqueting">Banqueting / Catering / Event</option>
                <option value="hotel">Hotel personeel</option>
                <option value="overig">Overig / nog niet zeker</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label htmlFor="message" className="mb-2 block text-sm font-medium">
                Bericht
              </label>
              <textarea
                id="message"
                name="message"
                rows={5}
                required
                placeholder="Periode, aantal personen, segment (casual / fine dining / hotel) en eventuele bijzonderheden."
                className="w-full rounded border border-gray-300 bg-white px-4 py-2 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
              />
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded bg-burgundy px-6 py-3 text-sm font-medium uppercase tracking-wide text-white transition-colors hover:bg-burgundy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-burgundy focus-visible:ring-offset-2"
              >
                Verstuur bericht
              </button>
              <p className="mt-3 text-xs text-ink-700">
                Door dit formulier te versturen gaat u akkoord met ons{" "}
                <a href="/privacybeleid/" className="text-burgundy underline">
                  privacybeleid
                </a>
                .
              </p>
            </div>
          </form>
        </section>

        {/* Quick CTA */}
        <section className="text-center">
          <p className="prose-cs mx-auto max-w-prose">
            <strong>Liever direct contact?</strong> Bel{" "}
            <a href={`tel:${site.phone}`} className="text-burgundy underline-offset-4 hover:underline">
              {site.phoneDisplay}
            </a>{" "}
            of mail naar{" "}
            <a href={`mailto:${site.email}`} className="text-burgundy underline-offset-4 hover:underline">
              {site.email}
            </a>
            .
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <CTAButton href={`mailto:${site.email}`} variant="primary">
              Mail ons
            </CTAButton>
            <CTAButton href={`tel:${site.phone}`} variant="secondary">
              Bel direct
            </CTAButton>
          </div>
        </section>
      </article>
    </>
  );
}
