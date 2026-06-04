import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { PageHero, SectionLabel } from "@/components/PageHero";
import {
  breadcrumbNode,
  buildGraph,
  webpageNode,
} from "@/lib/schema";
import { site } from "@/lib/site";

import { ContactForm } from "./ContactForm";

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
      >
        <a
          href={site.intake.client}
          className="rounded-full bg-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-900 transition-colors hover:bg-cream"
        >
          Vraag personeel aan
        </a>
        <a
          href={`tel:${site.phone}`}
          className="rounded-full border border-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-white hover:text-ink-900"
        >
          Bel {site.phoneDisplay}
        </a>
      </PageHero>

      {/* Primary intake CTA — native aanvraagformulier */}
      <section className="bg-bg-gray py-12 md:py-16">
        <div className="mx-auto max-w-container px-4">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 rounded-lg border border-burgundy/20 bg-white p-8 text-center md:flex-row md:items-center md:justify-between md:gap-8 md:p-10 md:text-left">
            <div className="flex-1">
              <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
                Aanvraagformulier
              </p>
              <h2 className="mt-2 font-serif text-2xl text-ink-900 md:text-3xl">
                Vraag personeel aan in 5 minuten
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-700 md:text-base">
                Vertel ons rol, periode, segment en bijzonderheden via ons
                online formulier. Wij matchen handmatig binnen 4-24 uur.
              </p>
            </div>
            <a
              href={site.intake.client}
              className="shrink-0 rounded-full bg-burgundy px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
            >
              Open aanvraagformulier →
            </a>
          </div>
        </div>
      </section>

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

      {/* Contact form on dark band — native submission (lands in admin inbox) */}
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

            <ContactForm />
          </div>
        </div>
      </section>
    </>
  );
}
