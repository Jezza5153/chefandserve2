import type { Metadata } from "next";
import Link from "next/link";
import { CTAButton } from "@/components/CTAButton";
import { JsonLd } from "@/components/JsonLd";
import { TrustBanner } from "@/components/TrustBanner";
import {
  breadcrumbNode,
  buildGraph,
  personMaartenNode,
  webpageNode,
} from "@/lib/schema";
import { site } from "@/lib/site";

const SLUG = "over-maarten";
const TITLE = "Over Maarten Hogeveen — Founder Chef & Serve";
const DESCRIPTION =
  "Maarten Hogeveen: 20+ jaar in Amsterdamse topkeukens (Lute, Vijff Vlieghen, Swarte Walvis, Mario, Chefstable), oprichter JUSTHORECA, nu Chef & Serve.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/${SLUG}/` },
};

export default function Page() {
  const url = `${site.url}/${SLUG}/`;
  const pageGraph = buildGraph(
    webpageNode({ url, name: TITLE, description: DESCRIPTION }),
    personMaartenNode(),
    breadcrumbNode([
      { name: "Home", url: `${site.url}/` },
      { name: "Wie zijn wij", url: `${site.url}/who-we-are/` },
      { name: "Over Maarten", url },
    ]),
  );

  return (
    <>
      <JsonLd data={pageGraph} />

      <article className="mx-auto max-w-container px-4 py-section-y-mobile md:py-section-y-tablet lg:py-section-y">
        <TrustBanner />

        <header className="mb-12">
          <h1 className="mb-6">Over Maarten Hogeveen</h1>
          <p className="prose-cs text-lg">
            Patron Cuisinier, oprichter en eigenaar van Chef &amp; Serve.
            20+ jaar in de Amsterdamse hospitality — van casual brasserie tot
            sterrenkeuken — en de architect van het payroll-first model
            waarmee wij in 2026 staan.
          </p>
        </header>

        <section className="prose-cs mb-12">
          <h2>Carrière in de Amsterdamse top</h2>
          <p>
            Maarten begon als jonge kok en bouwde zijn vak op in een rij
            keukens die de stad mede hebben gevormd:
          </p>
          <ul>
            <li>
              <strong>Lute (Restaurant Lute)</strong> — fine-dining onder de
              vlag van Peter Lute, één van Amsterdams toonaangevende
              gastronomische adressen
            </li>
            <li>
              <strong>d'Vijff Vlieghen</strong> — Nederlandse keuken op
              wereldniveau in een 17e-eeuws pand aan de Spuistraat
            </li>
            <li>
              <strong>d'Swarte Walvis</strong> — Zaanse hospitality-klassieker
              met een internationale klantenkring
            </li>
            <li>
              <strong>Mario</strong> — Italiaanse keuken, fast-paced
              brasserie-stijl met focus op verse pasta en gastvrijheid
            </li>
            <li>
              <strong>Chefstable</strong> — chef's-table-concept met
              interactieve, vakgerichte gastvrijheid
            </li>
          </ul>

          <h2>JUSTHORECA: 2017-2025</h2>
          <p>
            In 2017 richtte Maarten <strong>JUSTHORECA</strong> op — een
            Amsterdams uitzendbureau voor chefs en horecapersoneel dat in 8
            jaar uitgroeide tot één van de bekendere namen in de regio.
            JUSTHORECA werkte voornamelijk via ZZP-constructies, wat tot 2024
            de standaard was in de horeca.
          </p>
          <p>
            In 2025 maakte de Nederlandse overheid een einde aan die
            werkwijze: de <strong>handhaving van de Wet DBA</strong>
            (Deregulering Beoordeling Arbeidsrelaties) maakte het inzetten van
            ZZP-koks bij langdurige inhuur juridisch onhoudbaar. Het oude
            verdienmodel was niet langer compliant — en niet langer eerlijk
            voor de chefs die het werk leveren.
          </p>
          <p>
            Maarten besloot JUSTHORECA stop te zetten en opnieuw te beginnen
            met een schoon, juridisch sluitend model:{" "}
            <strong>Chef &amp; Serve</strong>.
          </p>

          <h2>Chef &amp; Serve: 2025 — heden</h2>
          <p>
            Chef &amp; Serve is gebouwd op één uitgangspunt:{" "}
            <strong>100% loondienst, geen ZZP, geen achterdeur</strong>.
            Wij zijn de juridische werkgever van iedereen die wij plaatsen —
            wij betalen het loon, dragen de loonheffing af, regelen vakantie­geld,
            pensioen en doorbetaling bij ziekte.
          </p>
          <p>
            Voor klanten betekent dat: geen Wet DBA-risico, geen achteraf-naheffing,
            geen schijnzelfstandigheid. Voor chefs en bediening: zekerheid,
            eerlijke betaling en een werkgever die naast ze staat — niet
            tegen.
          </p>

          <h2>Wat maakt onze aanpak anders?</h2>
          <p>
            Veel uitzendbureaus zijn anonieme platforms. Wij zijn dat
            bewust niet. Maarten neemt zelf nog steeds het eerste gesprek met
            elke nieuwe klant. Hij kent het verschil tussen een casual brasserie
            en fine dining van binnenuit, en matcht op vakniveau — niet op
            beschikbaarheid alleen.
          </p>
          <p>
            <em>"Ik heb 20 jaar in deze keukens gestaan. Ik weet wat er
            van een chef gevraagd wordt op zondagochtend bij 80 covers, en ik
            weet welke man of vrouw daar het beste past."</em>
          </p>

          <h2>Achtergrond &amp; bereik</h2>
          <ul>
            <li>20+ jaar ervaring in Amsterdamse top-hospitality</li>
            <li>8 jaar oprichter/eigenaar JUSTHORECA (2017-2025)</li>
            <li>Persoonlijk netwerk van {site.network.chefs}+ gescreende koks en hospitality-pros</li>
            <li>Wekelijkse groei van ~{site.network.growthPerWeek} nieuwe vakmensen in het netwerk</li>
            <li>Gevestigd in Amsterdam, actief in heel de Randstad</li>
          </ul>
        </section>

        {/* Cross-links */}
        <section className="prose-cs mb-12">
          <h2>Meer lezen</h2>
          <ul>
            <li>
              <Link href="/ik-ben-maarten-chef-and-serve/" className="text-burgundy underline-offset-4 hover:underline">
                Maarten in eigen woorden — waarom Chef &amp; Serve
              </Link>
            </li>
            <li>
              <Link href="/payroll-chef-inhuren/" className="text-burgundy underline-offset-4 hover:underline">
                Onze payroll-aanpak uitgelegd
              </Link>
            </li>
            <li>
              <Link href="/who-we-are/" className="text-burgundy underline-offset-4 hover:underline">
                Wie wij zijn als bedrijf
              </Link>
            </li>
          </ul>
        </section>

        {/* CTA */}
        <section className="rounded bg-bg-gray p-8 text-center md:p-12">
          <h2 className="mb-4">Direct in contact met Maarten?</h2>
          <p className="mx-auto mb-6 max-w-prose text-ink-700">
            Hij neemt zelf het eerste gesprek met nieuwe klanten. Bel of mail,
            en u krijgt binnen een uur reactie.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <CTAButton href={`tel:${site.phone}`} variant="primary">
              Bel {site.phoneDisplay}
            </CTAButton>
            <CTAButton href={`mailto:${site.email}`} variant="secondary">
              Mail ons
            </CTAButton>
          </div>
        </section>
      </article>
    </>
  );
}
