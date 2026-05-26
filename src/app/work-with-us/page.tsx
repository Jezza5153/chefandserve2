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

const SLUG = "work-with-us";
const TITLE = "Werken bij Chef & Serve — Loondienst, premium plekken, vrijheid";
const DESCRIPTION =
  "Werk als chef, kok of bediening in Amsterdamse tophotels en topkeukens. 100% loondienst, persoonlijke matching, flexibele inzet, eerlijke tarieven. Solliciteer direct.";

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
      { name: "Werken bij Chef & Serve", url },
    ]),
  );

  return (
    <>
      <JsonLd data={pageGraph} />

      <article className="mx-auto max-w-container px-4 py-section-y-mobile md:py-section-y-tablet lg:py-section-y">
        <TrustBanner />

        <header className="mb-12">
          <h1 className="mb-6">Werken bij Chef &amp; Serve</h1>
          <p className="prose-cs text-lg">
            Werken bij Amsterdamse tophotels en topkeukens, met de zekerheid
            van een loondienst-contract en de flexibiliteit van een vrij
            rooster. Bij Chef &amp; Serve combineer je het beste van twee
            werelden.
          </p>
        </header>

        <section className="prose-cs mb-12">
          <h2>Voor wie zijn wij?</h2>
          <ul>
            <li>Chefs, koks en sous chefs van commis tot executive niveau</li>
            <li>Banqueting chefs, breakfast chefs, patissiers, kokerellen</li>
            <li>Hosts, gastvrouwen, runners en ervaren bediening</li>
            <li>Keukenhulpen en assistenten met horeca-affiniteit</li>
            <li>Catering- en eventprofessionals (parttime &amp; fulltime)</li>
          </ul>

          <h2>Wat bieden wij?</h2>
          <ul>
            <li>
              <strong>Loondienst-zekerheid</strong> — vast contract met
              loonbetaling, pensioen, vakantiegeld en doorbetaling bij ziekte
            </li>
            <li>
              <strong>Premium werkplekken</strong> — 4- en 5-sterren hotels,
              fine-dining restaurants, banqueting locaties en exclusieve events
            </li>
            <li>
              <strong>Eerlijke tarieven</strong> — marktconforme uurlonen,
              transparante reiskostenvergoeding
            </li>
            <li>
              <strong>Persoonlijke matching</strong> — wij kiezen een plek die
              past bij jouw niveau, stijl en wensen — geen anoniem rooster
            </li>
            <li>
              <strong>Flexibiliteit</strong> — beschikbaarheid in overleg, geen
              verplicht-volle weken
            </li>
            <li>
              <strong>Directe begeleiding</strong> — Maarten kent de
              Amsterdamse keukens van binnenuit en helpt jou groeien in je vak
            </li>
          </ul>

          <h2>Hoe werkt aanmelden?</h2>
          <ol>
            <li>Stuur een mail met je cv en korte motivatie naar <a href={`mailto:${site.email}`} className="text-burgundy underline-offset-4 hover:underline">{site.email}</a></li>
            <li>Wij plannen een korte kennismaking — telefonisch of op kantoor</li>
            <li>Bij een match: contract op maat, eerste plaatsing binnen 1-2 weken</li>
            <li>Begeleiding gedurende je inzet — wij zijn je werkgever, ook tijdens je shifts</li>
          </ol>

          <h2>Onze waarden voor het team</h2>
          <p>
            Wij behandelen onze chefs en hospitality-pros als professionals,
            niet als nummers. Eerlijke communicatie, snelle reactie op vragen,
            duidelijke roosters en een werkgever die naast je staat — niet
            tegen je. Geen valse beloftes, geen onverwachte inhoudingen, geen
            "ZZP via achterdeur".
          </p>
        </section>

        {/* CTA */}
        <section className="rounded bg-bg-gray p-8 text-center md:p-12">
          <h2 className="mb-4">Klaar voor je volgende stap?</h2>
          <p className="mx-auto mb-6 max-w-prose text-ink-700">
            Stuur je cv en motivatie naar {site.email} of bel ons direct.
            Wij reageren binnen een werkdag.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <CTAButton href={`mailto:${site.email}?subject=Sollicitatie`} variant="primary">
              Stuur je cv
            </CTAButton>
            <CTAButton href={`tel:${site.phone}`} variant="secondary">
              Bel {site.phoneDisplay}
            </CTAButton>
          </div>
        </section>
      </article>
    </>
  );
}
