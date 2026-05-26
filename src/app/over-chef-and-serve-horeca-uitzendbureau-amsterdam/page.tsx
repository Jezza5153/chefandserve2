import type { Metadata } from "next";
import Link from "next/link";
import { ClosingCTA } from "@/components/ClosingCTA";
import { JsonLd } from "@/components/JsonLd";
import { PageHero, SectionLabel } from "@/components/PageHero";
import { SplitSection } from "@/components/SplitSection";
import { TrustBanner } from "@/components/TrustBanner";
import {
  articleNode,
  breadcrumbNode,
  buildGraph,
  webpageNode,
} from "@/lib/schema";
import { site } from "@/lib/site";

const SLUG = "over-chef-and-serve-horeca-uitzendbureau-amsterdam";
const TITLE = "Over Chef & Serve — Horeca Uitzendbureau Amsterdam";
const DESCRIPTION =
  "Chef & Serve is een Amsterdams horeca uitzendbureau in 100% loondienst. Opgericht door Maarten Hogeveen, 200+ koks in netwerk, Wet DBA 2026 compliant.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/${SLUG}/` },
};

const services = [
  "Executive chef, chef de cuisine, sous chef, chef de partie",
  "Commis, kok en keukenhulp",
  "Banqueting chef, breakfast chef, roomservice kok, patissier",
  "Maître d'hôtel, host, gastvrouw, runner, ervaren bediening",
  "Eventcoördinatie en complete brigades voor catering",
  "Werving & selectie voor vaste posities",
];

const clients = [
  "4- en 5-sterren hotels in Amsterdam en de Randstad",
  "Fine-dining en casual-dining restaurants",
  "Catering-bedrijven en eventlocaties",
  "Banqueting- en bruiloftslocaties",
  "Corporate horeca (kantoor-restaurants, hospitality-suites)",
  "Hotels en restaurants met seizoenspieken",
];

const process = [
  { n: "01", t: "Briefing", b: "Rol, periode, segment, bijzonderheden — via mail, telefoon of formulier." },
  { n: "02", t: "Match", b: `Handmatige selectie uit ${site.network.chefs}+ pros, wekelijks groeiend.` },
  { n: "03", t: "Bevestiging", b: "Naam, profiel en afspraken binnen 4-24 uur." },
  { n: "04", t: "Inzet", b: "Onze pro op uw locatie. Wij blijven juridisch werkgever." },
  { n: "05", t: "Opvolging", b: "Bij vragen, ziekte of nieuwe behoefte zijn wij direct bereikbaar." },
];

const legal = [
  `Geregistreerd bij Kamer van Koophandel onder nummer ${site.kvk}`,
  `Gevestigd op ${site.address.street}, ${site.address.postalCode} ${site.address.locality}`,
  "100% loondienst-model — geen ZZP-tussenkomst",
  "Compliant met Wet DBA, handhaving 2026 en latere wetgeving",
  "Eigen loonadministratie en arbeidsrechtelijke contracten",
];

export default function Page() {
  const url = `${site.url}/${SLUG}/`;
  const pageGraph = buildGraph(
    webpageNode({ url, name: TITLE, description: DESCRIPTION }),
    articleNode({
      url,
      headline: TITLE,
      description: DESCRIPTION,
      datePublished: "2025-12-01",
      dateModified: "2026-05-26",
    }),
    breadcrumbNode([
      { name: "Home", url: `${site.url}/` },
      { name: "Over Chef & Serve", url },
    ]),
  );

  return (
    <>
      <JsonLd data={pageGraph} />

      <PageHero
        eyebrow="Over Chef & Serve"
        title="Horeca uitzendbureau in Amsterdam"
        intro={
          <p>
            Premium hospitality-staffing voor hotels, restaurants, catering en
            evenementen. 100% in loondienst, opgericht door Maarten Hogeveen.
          </p>
        }
        image="/images/restaurant-interior.jpg"
        imageAlt="Chef & Serve restaurant interior"
      />

      <section className="bg-white py-12">
        <div className="mx-auto max-w-container px-4">
          <TrustBanner />
        </div>
      </section>

      {/* Wat doet Chef & Serve */}
      <SplitSection
        eyebrow="Wat doen wij?"
        title="De verbinding tussen pro en plek"
        body={
          <>
            <p>
              Wij verbinden hospitality-professionals met de werkgevers die hen
              nodig hebben. Het verschil met de meeste uitzendbureaus:
            </p>
            <ul>
              <li>
                <strong>Wij zijn juridisch werkgever</strong> van iedereen die
                wij plaatsen — geen ZZP-constructies, geen freelance-contract.
              </li>
              <li>
                <strong>Wij doen persoonlijke matching</strong> — Maarten kent
                de Amsterdamse horeca-scene van binnenuit.
              </li>
              <li>
                <strong>Wij dragen het risico</strong> — bij ziekte, uitval of
                juridische problemen is dat ons probleem, niet dat van de
                horecazaak.
              </li>
            </ul>
          </>
        }
        image="/images/service-werving.jpg"
        imageAlt="Chef plating in Amsterdam restaurant"
      />

      {/* Voor wie + welke rollen — twee kolommen lijst */}
      <section className="bg-bg-gray py-20 md:py-28">
        <div className="mx-auto max-w-container px-4">
          <div className="grid gap-12 md:grid-cols-2 lg:gap-20">
            <div>
              <SectionLabel>Voor wie werken wij?</SectionLabel>
              <h2 className="mt-3 font-serif text-3xl text-ink-900 md:text-4xl">
                Onze klanten
              </h2>
              <ul className="mt-6 space-y-3">
                {clients.map((c) => (
                  <li key={c} className="flex gap-3 text-ink-700">
                    <span className="text-burgundy">—</span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <SectionLabel>Welke rollen leveren wij?</SectionLabel>
              <h2 className="mt-3 font-serif text-3xl text-ink-900 md:text-4xl">
                Ons aanbod
              </h2>
              <ul className="mt-6 space-y-3">
                {services.map((s) => (
                  <li key={s} className="flex gap-3 text-ink-700">
                    <span className="text-burgundy">—</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Process */}
      <section className="bg-white py-20 md:py-28">
        <div className="mx-auto max-w-container px-4">
          <div className="mb-12">
            <SectionLabel>Hoe wij werken</SectionLabel>
            <h2 className="mt-3 max-w-3xl font-serif text-3xl text-ink-900 md:text-5xl">
              Onze service in vijf stappen
            </h2>
          </div>

          <ol className="grid gap-10 md:grid-cols-2 lg:grid-cols-5">
            {process.map((s) => (
              <li key={s.n}>
                <div className="font-serif text-5xl text-burgundy md:text-6xl">
                  {s.n}
                </div>
                <h3 className="mt-4 font-serif text-xl text-ink-900">{s.t}</h3>
                <p className="mt-3 text-sm leading-relaxed text-ink-700">{s.b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Geschiedenis */}
      <SplitSection
        reverse
        bg="ink"
        eyebrow="Onze geschiedenis"
        title="Van JUSTHORECA naar Chef & Serve"
        body={
          <>
            <p>
              Chef &amp; Serve is opgericht in 2025 door Maarten Hogeveen, na
              8 jaar JUSTHORECA (2017-2025). Toen de Belastingdienst in 2025
              handhaving op de Wet DBA aankondigde voor de horeca, was
              JUSTHORECA's ZZP-model niet langer compliant.
            </p>
            <p>
              Maarten heeft het bedrijf gesloten en herbouwd onder de naam
              Chef &amp; Serve — met dezelfde mensen en kennis, maar nu
              volledig in loondienst.
            </p>
            <p>
              <Link
                href="/over-maarten/"
                className="font-ui text-[11px] uppercase tracking-[0.18em] text-cream underline-offset-4 hover:underline"
              >
                Lees over Maarten →
              </Link>
            </p>
          </>
        }
        image="/images/maarten-portrait.jpg"
        imageAlt="Maarten Hogeveen"
      />

      {/* Juridische basis */}
      <section className="bg-bg-gray py-20 md:py-28">
        <div className="mx-auto max-w-container px-4">
          <div className="mb-12 text-center">
            <SectionLabel>Juridische basis</SectionLabel>
            <h2 className="mx-auto mt-3 max-w-3xl font-serif text-3xl text-ink-900 md:text-5xl">
              Zonder verrassingen
            </h2>
          </div>
          <ul className="mx-auto max-w-2xl space-y-4 text-center">
            {legal.map((l) => (
              <li key={l} className="text-ink-700">
                {l}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <ClosingCTA
        heading="Personeel nodig of vragen?"
        body="Stuur een mail of bel direct. Wij reageren binnen een uur tijdens werkdagen voor een korte briefing en de juiste match."
      />
    </>
  );
}
