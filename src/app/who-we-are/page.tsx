import type { Metadata } from "next";
import Link from "next/link";
import { ClosingCTA } from "@/components/ClosingCTA";
import { JsonLd } from "@/components/JsonLd";
import { PageHero, SectionLabel } from "@/components/PageHero";
import { SplitSection } from "@/components/SplitSection";
import {
  breadcrumbNode,
  buildGraph,
  webpageNode,
} from "@/lib/schema";
import { site } from "@/lib/site";

const SLUG = "who-we-are";
const TITLE = "Wie zijn wij — Chef & Serve, Amsterdam";
const DESCRIPTION =
  "Chef & Serve is opgericht door Maarten Hogeveen na 20+ jaar in Amsterdamse topkeukens. Premium horeca uitzendbureau, 100% loondienst, persoonlijke matching.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/${SLUG}/` },
};

const values = [
  {
    label: "Loondienst",
    title: "100% in loondienst",
    body:
      "Geen schijnzelfstandigheid, geen fiscale risico's voor uw bedrijf, geen onverwachte naheffing. Wij zijn juridisch werkgever van iedereen die wij plaatsen.",
  },
  {
    label: "Matching",
    title: "Persoonlijke matching",
    body:
      "Elke plaatsing wordt handmatig beoordeeld door Maarten en het team. Geen algoritme, geen blind-platform — wel vakkennis en mensenkennis.",
  },
  {
    label: "Netwerk",
    title: "Premium netwerk",
    body: `${site.network.chefs}+ gescreende koks en hospitality-pros in actief netwerk, wekelijks groeiend met circa ${site.network.growthPerWeek} nieuwe vakmensen.`,
  },
  {
    label: "Snelheid",
    title: "24 uur levertijd",
    body:
      "Bevestiging binnen 4-24 uur, afhankelijk van urgentie. Bij ziekte of uitval is vervanging onze verantwoordelijkheid.",
  },
];

export default function Page() {
  const url = `${site.url}/${SLUG}/`;
  const pageGraph = buildGraph(
    webpageNode({ url, name: TITLE, description: DESCRIPTION }),
    breadcrumbNode([
      { name: "Home", url: `${site.url}/` },
      { name: "Wie zijn wij", url },
    ]),
  );

  return (
    <>
      <JsonLd data={pageGraph} />

      <PageHero
        eyebrow="Over Chef & Serve"
        title="Built on people, driven by purpose."
        intro={
          <p>
            Bij Chef &amp; Serve geloven wij dat échte gastvrijheid begint
            achter de schermen — bij de mensen die haar maken.
          </p>
        }
        image="/images/about-split.jpg"
        imageAlt="Chef & Serve team"
      />

      {/* Mission split */}
      <SplitSection
        eyebrow="Onze missie"
        title="Gebouwd op vertrouwen, gedreven door mensen"
        body={
          <>
            <p>
              <em>Serving the people, making the moment.</em> Wij geloven dat
              elke maaltijd, elk evenement en elke gast verdient om bediend te
              worden door iemand die het vak in zijn vingers heeft.
            </p>
            <p>
              Onze chefs en bediening zijn geen anoniem-platform invullers — het
              zijn pros die wij kennen, getest hebben en persoonlijk matchen
              met uw keuken of zaak.
            </p>
            <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
              — Maarten Hogeveen
            </p>
          </>
        }
        image="/images/maarten-portrait.jpg"
        imageAlt="Maarten Hogeveen, oprichter Chef & Serve"
      />

      {/* History split — reverse layout */}
      <SplitSection
        bg="gray"
        reverse
        eyebrow="Onze geschiedenis"
        title="Van JUSTHORECA naar Chef & Serve"
        body={
          <>
            <p>
              Maarten richtte in 2017 JUSTHORECA op — een toonaangevend
              uitzendbureau voor horecapersoneel in Amsterdam. Toen de
              ZZP-crackdown in 2025 het oude verdienmodel onhoudbaar maakte,
              stopte JUSTHORECA.
            </p>
            <p>
              Chef &amp; Serve is de directe opvolger, herbouwd op een
              fundament dat juridisch en fiscaal toekomstvast is:{" "}
              <strong>100% payroll</strong>, geen ZZP-constructies, Wet DBA
              2026 compliant.
            </p>
            <p>
              <Link
                href="/over-maarten/"
                className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy underline-offset-4 hover:underline"
              >
                Lees meer over Maarten →
              </Link>
            </p>
          </>
        }
        image="/images/restaurant-interior.jpg"
        imageAlt="Amsterdam restaurant"
      />

      {/* Values grid */}
      <section className="bg-white py-20 md:py-28">
        <div className="mx-auto max-w-container px-4">
          <div className="mb-16 text-center">
            <SectionLabel>Wat ons onderscheidt</SectionLabel>
            <h2 className="mx-auto mt-3 max-w-3xl font-serif text-3xl text-ink-900 md:text-5xl">
              Vier dingen waar wij niet op inleveren
            </h2>
          </div>

          <div className="grid gap-12 md:grid-cols-2 lg:gap-16">
            {values.map((v) => (
              <div key={v.label}>
                <SectionLabel>{v.label}</SectionLabel>
                <h3 className="mt-3 font-serif text-2xl text-ink-900 md:text-3xl">
                  {v.title}
                </h3>
                <p className="mt-4 leading-relaxed text-ink-700">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Editorial quote */}
      <section className="bg-burgundy py-20 text-center text-white md:py-28">
        <div className="mx-auto max-w-container px-4">
          <p className="font-ui text-[11px] uppercase tracking-[0.3em] text-cream">
            In eigen woorden
          </p>
          <blockquote className="mx-auto mt-6 max-w-3xl font-serif text-2xl leading-snug text-white md:text-4xl">
            &ldquo;Ik heb 20 jaar in deze keukens gestaan. Ik weet wat er van een
            chef gevraagd wordt op zondagochtend bij 80 covers, en ik weet welke
            man of vrouw daar het beste past.&rdquo;
          </blockquote>
          <p className="mt-8 font-ui text-[11px] uppercase tracking-[0.18em] text-cream">
            — Maarten Hogeveen, oprichter
          </p>
        </div>
      </section>

      <ClosingCTA
        heading="Meer weten over hoe wij werken?"
        body="Plan een korte kennismaking. Maarten neemt zelf het eerste gesprek — zo weet u direct met wie u zaken doet."
      />
    </>
  );
}
