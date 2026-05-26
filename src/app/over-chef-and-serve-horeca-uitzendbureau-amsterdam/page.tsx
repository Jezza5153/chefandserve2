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

const SLUG = "over-chef-and-serve-horeca-uitzendbureau-amsterdam";
const TITLE = "Over Chef & Serve — Horeca Uitzendbureau Amsterdam";
const DESCRIPTION =
  "Chef & Serve is een Amsterdams horeca uitzendbureau in 100% loondienst. Opgericht door Maarten Hogeveen, 200+ koks in netwerk, Wet DBA 2026 compliant.";

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
      { name: "Over Chef & Serve", url },
    ]),
  );

  return (
    <>
      <JsonLd data={pageGraph} />

      <article className="mx-auto max-w-container px-4 py-section-y-mobile md:py-section-y-tablet lg:py-section-y">
        <TrustBanner />

        <header className="mb-12">
          <h1 className="mb-6">
            Over Chef &amp; Serve — Horeca Uitzendbureau Amsterdam
          </h1>
          <p className="prose-cs text-lg">
            Chef &amp; Serve is een premium horeca uitzendbureau in Amsterdam,
            opgericht door <Link href="/over-maarten/" className="text-burgundy underline-offset-4 hover:underline">Maarten Hogeveen</Link>{" "}
            in 2025. Wij leveren chefs, koks, bediening en complete hospitality-teams
            aan hotels, restaurants, catering en evenementen — volledig in
            loondienst, Wet DBA 2026 compliant.
          </p>
        </header>

        <section className="prose-cs mb-12">
          <h2>Wat doet Chef &amp; Serve?</h2>
          <p>
            Wij verbinden hospitality-professionals met de werkgevers die hen
            nodig hebben. Het verschil met de meeste uitzendbureaus:
          </p>
          <ul>
            <li>
              <strong>Wij zijn juridisch werkgever</strong> van iedereen die
              wij plaatsen. Geen ZZP-constructies, geen "freelance contract",
              geen verkapte schijnzelfstandigheid.
            </li>
            <li>
              <strong>Wij doen persoonlijke matching</strong> — Maarten kent
              de Amsterdamse horeca-scene van binnenuit en koppelt op vakniveau
              en stijl, niet alleen op uurloon en beschikbaarheid.
            </li>
            <li>
              <strong>Wij dragen het risico</strong> — bij ziekte, uitval of
              juridische problemen is dat ons probleem, niet dat van de
              horecazaak.
            </li>
          </ul>

          <h2>Voor wie werken wij?</h2>
          <ul>
            <li>4- en 5-sterren hotels in Amsterdam en de Randstad</li>
            <li>Fine-dining en casual-dining restaurants</li>
            <li>Catering-bedrijven en eventlocaties</li>
            <li>Banqueting- en bruiloftslocaties</li>
            <li>Corporate horeca (kantoor-restaurants, hospitality-suites)</li>
            <li>Hotels en restaurants met seizoenspieken</li>
          </ul>

          <h2>Welke rollen leveren wij?</h2>
          <ul>
            <li>Executive chef, chef de cuisine, sous chef, chef de partie</li>
            <li>Commis, kok en keukenhulp</li>
            <li>Banqueting chef, breakfast chef, roomservice kok, patissier</li>
            <li>Maître d'hôtel, host, gastvrouw, runner, ervaren bediening</li>
            <li>Eventcoördinatie en complete brigades voor catering</li>
            <li>Werving &amp; selectie voor vaste posities (hospitality recruitment)</li>
          </ul>

          <h2>Hoe wij werken — onze service</h2>
          <ol>
            <li>
              <strong>Briefing</strong> — u stuurt ons rol, periode, segment
              en eventuele bijzonderheden. Mail, telefoon of contactformulier.
            </li>
            <li>
              <strong>Match</strong> — wij selecteren handmatig uit ons netwerk
              van {site.network.chefs}+ gescreende pros, gegroeid wekelijks
              met ~{site.network.growthPerWeek} nieuwe mensen.
            </li>
            <li>
              <strong>Bevestiging</strong> — u krijgt naam, profiel en
              afspraken binnen 4-24 uur, afhankelijk van urgentie.
            </li>
            <li>
              <strong>Inzet</strong> — onze professional staat op uw locatie.
              Wij blijven juridisch werkgever en factureren u via een
              transparant uurtarief.
            </li>
            <li>
              <strong>Opvolging</strong> — bij vragen, ziekte of nieuwe
              behoefte zijn wij direct bereikbaar.
            </li>
          </ol>

          <h2>Onze tarieven</h2>
          <p>
            All-in payroll-tarieven (loonheffing, sociale lasten, vakantiegeld
            en ziekterisico inbegrepen):
          </p>
          <ul>
            <li>Keukenhulp — vanaf €{site.pricing.keukenhulp}/uur</li>
            <li>Bediening — vanaf €{site.pricing.bediening}/uur</li>
            <li>Commis — vanaf €{site.pricing.commis}/uur</li>
            <li>Chef de partie — vanaf €{site.pricing.chefDePartie}/uur</li>
            <li>Sous chef — vanaf €{site.pricing.sousChef}/uur</li>
            <li>Chef de cuisine — vanaf €{site.pricing.chefDeCuisine}/uur</li>
          </ul>
          <p>
            Volledige tariefoverzicht en uitleg op{" "}
            <Link href="/our-offer/" className="text-burgundy underline-offset-4 hover:underline">
              ons aanbod
            </Link>
            .
          </p>

          <h2>Onze juridische basis</h2>
          <ul>
            <li>Geregistreerd bij Kamer van Koophandel onder nummer <strong>{site.kvk}</strong></li>
            <li>Gevestigd op {site.address.street}, {site.address.postalCode} {site.address.locality}</li>
            <li>100% loondienst-model — geen ZZP-tussenkomst</li>
            <li>Compliant met Wet DBA, handhaving 2026 en latere wetgeving</li>
            <li>Eigen loonadministratie en arbeidsrechtelijke contracten</li>
          </ul>

          <h2>Onze geschiedenis kort</h2>
          <p>
            Chef &amp; Serve is opgericht in 2025 door Maarten Hogeveen, na
            8 jaar JUSTHORECA (2017-2025). Toen de Belastingdienst in 2025
            handhaving op de Wet DBA aankondigde voor de horeca, was JUSTHORECA's
            ZZP-model niet langer compliant. Maarten heeft het bedrijf gesloten
            en herbouwd onder de naam Chef &amp; Serve — met dezelfde mensen
            en kennis, maar nu volledig in loondienst.
          </p>

          <h2>Onze missie</h2>
          <p>
            <em>Serving the people, making the moment.</em> Wij geloven dat
            kwaliteit in de horeca begint bij de mens die het werk doet — en
            dat die mens een werkgever verdient die naast hem of haar staat.
            Wij willen het uitzendbureau zijn dat zowel klanten als chefs
            vertrouwen, lange-termijn, zonder gedoe.
          </p>
        </section>

        {/* Cross-links */}
        <section className="prose-cs mb-12">
          <h2>Meer over ons</h2>
          <ul>
            <li>
              <Link href="/over-maarten/" className="text-burgundy underline-offset-4 hover:underline">
                Over Maarten Hogeveen — founder
              </Link>
            </li>
            <li>
              <Link href="/ik-ben-maarten-chef-and-serve/" className="text-burgundy underline-offset-4 hover:underline">
                Maarten in eigen woorden
              </Link>
            </li>
            <li>
              <Link href="/payroll-chef-inhuren/" className="text-burgundy underline-offset-4 hover:underline">
                Onze payroll-aanpak
              </Link>
            </li>
            <li>
              <Link href="/our-offer/" className="text-burgundy underline-offset-4 hover:underline">
                Ons aanbod &amp; tarieven
              </Link>
            </li>
            <li>
              <Link href="/work-with-us/" className="text-burgundy underline-offset-4 hover:underline">
                Werken bij Chef &amp; Serve
              </Link>
            </li>
          </ul>
        </section>

        {/* CTA */}
        <section className="rounded bg-bg-gray p-8 text-center md:p-12">
          <h2 className="mb-4">Personeel nodig of vragen?</h2>
          <p className="mx-auto mb-6 max-w-prose text-ink-700">
            Stuur een mail of bel direct. Wij reageren binnen een uur tijdens
            werkdagen voor een korte briefing en de juiste match.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <CTAButton href={`mailto:${site.email}`} variant="primary">
              Mail ons
            </CTAButton>
            <CTAButton href={`tel:${site.phone}`} variant="secondary">
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
