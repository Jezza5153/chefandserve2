import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { PageHero, SectionLabel } from "@/components/PageHero";
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

      <PageHero
        eyebrow="Contact"
        title="Personeel nodig? Een vraag? Bel of mail."
        intro={
          <p>
            Wij reageren binnen een uur tijdens werkdagen. Maarten neemt zelf
            het eerste gesprek met nieuwe klanten.
          </p>
        }
        image="/images/contact-cover.jpg"
        imageAlt="Chef & Serve Amsterdam"
      />

      {/* Contact methods */}
      <section className="bg-white py-16 md:py-24">
        <div className="mx-auto max-w-container px-4">
          <div className="grid gap-px overflow-hidden rounded border border-gray-200 bg-gray-200 md:grid-cols-3">
            <div className="bg-white p-8 md:p-10">
              <SectionLabel>Bel direct</SectionLabel>
              <h2 className="mt-3 font-serif text-xl text-ink-900 md:text-2xl">
                Het snelste antwoord
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-700">
                Maarten of het team neemt op tijdens kantooruren.
              </p>
              <a
                href={`tel:${site.phone}`}
                className="mt-5 inline-block font-serif text-2xl text-burgundy underline-offset-4 hover:underline md:text-3xl"
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

            <div className="bg-white p-8 md:p-10">
              <SectionLabel>Mail ons</SectionLabel>
              <h2 className="mt-3 font-serif text-xl text-ink-900 md:text-2xl">
                Voor briefings &amp; offertes
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-700">
                Stuur rol, periode, segment en eventuele bijzonderheden.
              </p>
              <a
                href={`mailto:${site.email}`}
                className="mt-5 inline-block font-serif text-xl text-burgundy underline-offset-4 hover:underline md:text-2xl"
              >
                {site.email}
              </a>
            </div>

            <div className="bg-white p-8 md:p-10">
              <SectionLabel>Bezoek ons</SectionLabel>
              <h2 className="mt-3 font-serif text-xl text-ink-900 md:text-2xl">
                Op afspraak
              </h2>
              <address className="mt-3 not-italic text-sm leading-relaxed text-ink-700">
                {site.address.street}
                <br />
                {site.address.postalCode} {site.address.locality}
                <br />
                {site.address.region}, Nederland
              </address>
              <a
                href={site.mapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy underline-offset-4 hover:underline"
              >
                Open in Google Maps →
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Contact form on dark band */}
      <section className="bg-ink-900 py-20 text-white md:py-28">
        <div className="mx-auto max-w-container px-4">
          <div className="grid gap-12 md:grid-cols-12">
            <div className="md:col-span-5">
              <p className="font-ui text-[11px] uppercase tracking-[0.3em] text-cream">
                Stuur een bericht
              </p>
              <h2 className="mt-3 font-serif text-3xl text-white md:text-5xl">
                Vertel ons waar u mee zit
              </h2>
              <p className="mt-6 max-w-md text-white/80">
                Vul het formulier in en wij nemen binnen een uur contact op
                tijdens werkdagen.
              </p>
              <p className="mt-8 text-sm text-white/60">
                Liever direct?
                <br />
                <a
                  href={`tel:${site.phone}`}
                  className="text-white underline-offset-4 hover:underline"
                >
                  {site.phoneDisplay}
                </a>
                <br />
                <a
                  href={`mailto:${site.email}`}
                  className="text-white underline-offset-4 hover:underline"
                >
                  {site.email}
                </a>
              </p>
            </div>

            <form
              action={`mailto:${site.email}`}
              method="post"
              encType="text/plain"
              className="grid gap-4 md:col-span-7 md:grid-cols-2"
            >
              <div className="md:col-span-1">
                <label
                  htmlFor="name"
                  className="mb-2 block font-ui text-[11px] uppercase tracking-[0.18em] text-cream"
                >
                  Naam
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  className="w-full rounded border border-white/20 bg-white/5 px-4 py-3 text-white placeholder-white/40 focus:border-cream focus:outline-none focus:ring-1 focus:ring-cream"
                />
              </div>

              <div className="md:col-span-1">
                <label
                  htmlFor="company"
                  className="mb-2 block font-ui text-[11px] uppercase tracking-[0.18em] text-cream"
                >
                  Bedrijf / Locatie
                </label>
                <input
                  type="text"
                  id="company"
                  name="company"
                  className="w-full rounded border border-white/20 bg-white/5 px-4 py-3 text-white placeholder-white/40 focus:border-cream focus:outline-none focus:ring-1 focus:ring-cream"
                />
              </div>

              <div className="md:col-span-1">
                <label
                  htmlFor="email"
                  className="mb-2 block font-ui text-[11px] uppercase tracking-[0.18em] text-cream"
                >
                  E-mail
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  required
                  className="w-full rounded border border-white/20 bg-white/5 px-4 py-3 text-white placeholder-white/40 focus:border-cream focus:outline-none focus:ring-1 focus:ring-cream"
                />
              </div>

              <div className="md:col-span-1">
                <label
                  htmlFor="phone"
                  className="mb-2 block font-ui text-[11px] uppercase tracking-[0.18em] text-cream"
                >
                  Telefoon
                </label>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  className="w-full rounded border border-white/20 bg-white/5 px-4 py-3 text-white placeholder-white/40 focus:border-cream focus:outline-none focus:ring-1 focus:ring-cream"
                />
              </div>

              <div className="md:col-span-2">
                <label
                  htmlFor="role"
                  className="mb-2 block font-ui text-[11px] uppercase tracking-[0.18em] text-cream"
                >
                  Welke rol zoekt u?
                </label>
                <select
                  id="role"
                  name="role"
                  className="w-full rounded border border-white/20 bg-white/5 px-4 py-3 text-white focus:border-cream focus:outline-none focus:ring-1 focus:ring-cream"
                >
                  <option value="" className="text-ink-900">Maak een keuze...</option>
                  <option value="chef" className="text-ink-900">Chef / Sous chef / Chef de partie</option>
                  <option value="kok" className="text-ink-900">Kok / Commis / Keukenhulp</option>
                  <option value="bediening" className="text-ink-900">Bediening / Host / Runner</option>
                  <option value="banqueting" className="text-ink-900">Banqueting / Catering / Event</option>
                  <option value="hotel" className="text-ink-900">Hotel personeel</option>
                  <option value="overig" className="text-ink-900">Overig / nog niet zeker</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label
                  htmlFor="message"
                  className="mb-2 block font-ui text-[11px] uppercase tracking-[0.18em] text-cream"
                >
                  Bericht
                </label>
                <textarea
                  id="message"
                  name="message"
                  rows={5}
                  required
                  placeholder="Periode, aantal personen, segment (casual / fine dining / hotel) en eventuele bijzonderheden."
                  className="w-full rounded border border-white/20 bg-white/5 px-4 py-3 text-white placeholder-white/40 focus:border-cream focus:outline-none focus:ring-1 focus:ring-cream"
                />
              </div>

              <div className="md:col-span-2">
                <button
                  type="submit"
                  className="rounded-full bg-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-900 transition-colors hover:bg-cream"
                >
                  Verstuur bericht
                </button>
                <p className="mt-3 text-xs text-white/50">
                  Door dit formulier te versturen gaat u akkoord met ons{" "}
                  <a href="/privacybeleid/" className="text-white underline">
                    privacybeleid
                  </a>
                  .
                </p>
              </div>
            </form>
          </div>
        </div>
      </section>
    </>
  );
}
