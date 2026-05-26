import type { Metadata } from "next";
import Link from "next/link";
import { CTAButton } from "@/components/CTAButton";
import { JsonLd } from "@/components/JsonLd";
import { TrustBanner } from "@/components/TrustBanner";
import {
  articleNode,
  breadcrumbNode,
  buildGraph,
  webpageNode,
} from "@/lib/schema";
import { site } from "@/lib/site";

const SLUG = "ik-ben-maarten-chef-and-serve";
const TITLE = "Ik ben Maarten — waarom ik Chef & Serve startte";
const DESCRIPTION =
  "Maarten Hogeveen in eigen woorden: 20 jaar in Amsterdamse topkeukens, oprichten en stoppen van JUSTHORECA, en waarom Chef & Serve nu 100% payroll is.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/${SLUG}/` },
};

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
      { name: "Over Maarten", url: `${site.url}/over-maarten/` },
      { name: "Ik ben Maarten", url },
    ]),
  );

  return (
    <>
      <JsonLd data={pageGraph} />

      <article className="mx-auto max-w-container px-4 py-section-y-mobile md:py-section-y-tablet lg:py-section-y">
        <TrustBanner />

        <header className="mb-12">
          <p className="mb-3 font-ui text-sm uppercase tracking-widest text-burgundy">
            In eigen woorden
          </p>
          <h1 className="mb-6">Ik ben Maarten — en dit is waarom Chef &amp; Serve er staat</h1>
          <p className="prose-cs text-lg italic">
            Een persoonlijk verhaal over 20 jaar in de keuken, het oprichten en
            stoppen van JUSTHORECA, en waarom payroll niet alleen "veiliger"
            is — het is gewoon eerlijker.
          </p>
        </header>

        <section className="prose-cs mb-12">
          <h2>Hoe ik in de keuken belandde</h2>
          <p>
            Ik ben in mijn jonge jaren begonnen als kok in Amsterdam. Geen
            koksopleiding met flikker-en-flikker, gewoon: in de keuken gaan
            staan en leren. Mijn eerste keukens waren ouderwetse brigades —
            geen ruimte voor fouten, geen ruimte voor halve waarheden.
            Je leerde door te doen en door te kijken.
          </p>
          <p>
            In de jaren erna heb ik in een hele rij keukens gestaan die ik nog
            steeds met grote waardering noem: <strong>Lute</strong> bij Peter
            Lute, <strong>d'Vijff Vlieghen</strong>, <strong>d'Swarte Walvis</strong>,{" "}
            <strong>Mario</strong>, <strong>Chefstable</strong>. Elke keuken
            heeft me iets geleerd — over discipline, over gastvrijheid, over
            wat een team kan bereiken als de mise-en-place klopt.
          </p>

          <h2>JUSTHORECA: wat we hebben opgebouwd</h2>
          <p>
            In 2017 heb ik <strong>JUSTHORECA</strong> opgericht. Ik zag dat
            veel keukens worstelden om de juiste mensen te vinden, en ik kende
            tegelijk veel goeie chefs die liever flexibel werkten dan vast bij
            één huis. Het idee was simpel: ik ga ze met elkaar verbinden.
          </p>
          <p>
            Acht jaar lang is dat gelukt. We werden een bekende naam in
            Amsterdam. Hotels, restaurants, eventbedrijven — ze belden ons
            voor de scherpe matches en de korte lijnen.
          </p>

          <h2>Waarom JUSTHORECA stopte</h2>
          <p>
            En toen kwam 2025. De Belastingdienst begon serieus te handhaven
            op de <strong>Wet DBA</strong> — de wet die zegt: als iemand
            werkt als werknemer, moet hij ook behandeld worden als werknemer.
            ZZP-constructies in de horeca werden onhoudbaar.
          </p>
          <p>
            Ik had twee keuzes. Doorploeteren met een model dat niet meer kon
            — en mijn klanten en chefs achterlaten met een naheffing als de
            controleur langskomt. Of het eerlijk oppakken en herbouwen op
            een fundament dat wél houdt.
          </p>
          <p>
            Ik heb voor het tweede gekozen. JUSTHORECA is netjes afgesloten,
            verplichtingen afgewikkeld, mensen geïnformeerd. En daarna ben ik
            opnieuw begonnen — met dezelfde mensen, dezelfde vakkennis, maar
            nu volledig in loondienst.
          </p>

          <h2>Waarom Chef &amp; Serve er is</h2>
          <p>
            Chef &amp; Serve is wat JUSTHORECA had moeten zijn als de Wet DBA
            in 2017 al was zoals nu: <strong>100% loondienst</strong>. Wij
            zijn de werkgever van iedereen die we plaatsen. Wij betalen het
            loon. Wij dragen de premies af. Wij regelen vakantie en
            doorbetaling bij ziekte. En wij dragen het volledige juridische
            risico — niet de horecazaak waar onze mensen werken.
          </p>
          <p>
            Voor de klant betekent dat: bel mij, mijn mensen staan binnen 24
            uur in je keuken, en je hebt nul fiscaal risico. Geen
            schijnzelfstandigheid, geen naheffing, geen "het stond toch in
            de overeenkomst".
          </p>
          <p>
            Voor de chef of kok betekent dat: vast contract, eerlijk loon,
            zekerheid bij ziekte en vakantie, en de vrijheid om te kiezen
            waar je werkt — Lisa Spols werkt nu bijvoorbeeld bij een aantal
            van onze hotels. Onze mensen worden niet als nummer ingezet,
            maar persoonlijk gematcht.
          </p>

          <h2>Wat ik beloof</h2>
          <p>
            Ik ben geen verkoper. Ik ben een kok die toevallig ook een
            bedrijf runt. Mijn beloftes zijn simpel:
          </p>
          <ul>
            <li>Ik neem het eerste gesprek met elke nieuwe klant zelf</li>
            <li>Wij zijn 100% loondienst, geen ZZP via achterdeur</li>
            <li>Wij matchen op vakniveau, niet op beschikbaarheid alleen</li>
            <li>Bij ziekte of uitval lossen wij het op — niet jij</li>
            <li>Wij worden niet groter dan we persoonlijk kunnen aanvoelen</li>
          </ul>

          <h2>Bel me</h2>
          <p>
            Als je personeel zoekt — kok, chef, bediening — bel me. Ik luister,
            ik vraag door, en als we kunnen leveren leg ik het uit. Als we het
            niet kunnen, zeg ik dat ook.
          </p>
          <p>
            <strong>{site.phoneDisplay}</strong> · <a href={`mailto:${site.email}`} className="text-burgundy underline-offset-4 hover:underline">{site.email}</a>
          </p>
          <p className="italic">— Maarten</p>
        </section>

        {/* Cross-links */}
        <section className="prose-cs mb-12">
          <h2>Verder lezen</h2>
          <ul>
            <li>
              <Link href="/over-maarten/" className="text-burgundy underline-offset-4 hover:underline">
                Achtergrond &amp; carrière van Maarten →
              </Link>
            </li>
            <li>
              <Link href="/payroll-chef-inhuren/" className="text-burgundy underline-offset-4 hover:underline">
                Hoe payroll precies werkt en wat het kost →
              </Link>
            </li>
            <li>
              <Link href="/who-we-are/" className="text-burgundy underline-offset-4 hover:underline">
                Wie zijn wij als bedrijf →
              </Link>
            </li>
          </ul>
        </section>

        {/* CTA */}
        <section className="rounded bg-bg-gray p-8 text-center md:p-12">
          <h2 className="mb-4">Direct in gesprek?</h2>
          <p className="mx-auto mb-6 max-w-prose text-ink-700">
            Bel of mail — Maarten of het team reageert binnen een uur tijdens
            werkdagen.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <CTAButton href={`tel:${site.phone}`} variant="primary">
              Bel {site.phoneDisplay}
            </CTAButton>
            <CTAButton href="/contact-us/" variant="secondary">
              Contactformulier
            </CTAButton>
          </div>
        </section>
      </article>
    </>
  );
}
