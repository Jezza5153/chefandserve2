import type { Metadata } from "next";
import Link from "next/link";
import { CTAButton } from "@/components/CTAButton";
import { JsonLd } from "@/components/JsonLd";
import { TrustBanner } from "@/components/TrustBanner";
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

      <article className="mx-auto max-w-container px-4 py-section-y-mobile md:py-section-y-tablet lg:py-section-y">
        <TrustBanner />

        <header className="mb-12">
          <h1 className="mb-6">Wie zijn wij</h1>
          <p className="prose-cs text-lg">
            Chef &amp; Serve is een Amsterdams horeca uitzendbureau, opgericht
            door <Link href="/over-maarten/" className="text-burgundy underline-offset-4 hover:underline">Maarten Hogeveen</Link> na
            20+ jaar in de top van de Amsterdamse hospitality. Wij combineren
            <strong> loondienst-zekerheid</strong>, <strong>persoonlijke matching</strong> en
            <strong> premium kwaliteit</strong> in één model.
          </p>
        </header>

        <section className="prose-cs mb-12">
          <h2>Onze missie</h2>
          <p>
            <em>Serving the people, making the moment.</em> Wij geloven dat
            elke maaltijd, elk evenement en elke gast verdient om bediend te
            worden door iemand die het vak in zijn vingers heeft. Onze chefs en
            bediening zijn geen anoniem-platform invullers — het zijn pros die
            wij kennen, getest hebben en persoonlijk matchen met uw keuken of
            zaak.
          </p>

          <h2>Onze geschiedenis</h2>
          <p>
            Maarten richtte in 2017 JUSTHORECA op — een toonaangevend
            uitzendbureau voor horecapersoneel in Amsterdam. Toen de
            ZZP-crackdown in 2025 het oude verdienmodel onhoudbaar maakte,
            stopte JUSTHORECA. Chef &amp; Serve is de directe opvolger,
            herbouwd op een fundament dat juridisch en fiscaal toekomstvast is:
            <strong> 100% payroll</strong>, geen ZZP-constructies, Wet DBA 2026
            compliant.
          </p>

          <h2>Wat ons onderscheidt</h2>
          <ul>
            <li>
              <strong>100% loondienst</strong> — geen schijnzelfstandigheid,
              geen fiscale risico's voor uw bedrijf, geen onverwachte naheffing
            </li>
            <li>
              <strong>Persoonlijke matching</strong> — elke plaatsing wordt
              handmatig beoordeeld. Geen algoritme, geen blind-platform
            </li>
            <li>
              <strong>Premium netwerk</strong> — {site.network.chefs}+
              gescreende koks en hospitality-pros, wekelijks groeiend met
              ~{site.network.growthPerWeek} nieuwe medewerkers
            </li>
            <li>
              <strong>24 uur levertijd</strong> — bevestiging binnen 4-24 uur,
              afhankelijk van urgentie
            </li>
            <li>
              <strong>Eigen vakervaring</strong> — Maarten kent het verschil
              tussen casual dining en fine dining van binnenuit, en matcht
              daarop
            </li>
          </ul>

          <h2>Onze waarden</h2>
          <p>
            Gebouwd op vertrouwen, gedreven door mensen. Wij zijn klein genoeg
            om elke chef persoonlijk te kennen, groot genoeg om binnen 24 uur
            de juiste match te leveren. Geen ronkende verkooppraat, geen
            verborgen kosten — gewoon de juiste mensen op de juiste plek,
            wanneer u ze nodig heeft.
          </p>
        </section>

        {/* CTA */}
        <section className="rounded bg-bg-gray p-8 text-center md:p-12">
          <h2 className="mb-4">Meer weten over hoe wij werken?</h2>
          <p className="mx-auto mb-6 max-w-prose text-ink-700">
            Plan een korte kennismaking. Maarten neemt zelf het eerste gesprek —
            zo weet u direct met wie u zaken doet.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <CTAButton href="/contact-us/" variant="primary">
              Plan een gesprek
            </CTAButton>
            <CTAButton href="/over-maarten/" variant="secondary">
              Lees over Maarten
            </CTAButton>
          </div>
        </section>
      </article>
    </>
  );
}
