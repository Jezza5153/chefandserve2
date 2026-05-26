import type { Metadata } from "next";
import Link from "next/link";
import { CTAButton } from "@/components/CTAButton";
import { ComparisonTable, standardComparisonRows } from "@/components/ComparisonTable";
import { FAQAccordion } from "@/components/FAQAccordion";
import { JsonLd } from "@/components/JsonLd";
import { TrustBanner } from "@/components/TrustBanner";
import { payrollPillarFaqs } from "@/lib/faqs";
import {
  articleNode,
  breadcrumbNode,
  buildGraph,
  faqPageNode,
  serviceNode,
  webpageNode,
} from "@/lib/schema";
import { site } from "@/lib/site";

const SLUG = "payroll-chef-inhuren";
const TITLE = "Payroll Chef Inhuren — 100% loondienst, geen ZZP-risico";
const DESCRIPTION =
  "Payroll chef inhuren zonder ZZP-risico. 100% loondienst, Wet DBA 2026 compliant, 200+ chefs in netwerk, binnen 24 uur inzetbaar in Amsterdam en Randstad.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/${SLUG}/` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `/${SLUG}/` },
};

export default function PayrollPillarPage() {
  const url = `${site.url}/${SLUG}/`;

  const pageGraph = buildGraph(
    articleNode({
      url,
      headline: TITLE,
      description: DESCRIPTION,
      datePublished: "2026-04-22",
      dateModified: new Date().toISOString(),
    }),
    webpageNode({ url, name: TITLE, description: DESCRIPTION }),
    breadcrumbNode([
      { name: "Home", url: `${site.url}/` },
      { name: "Payroll chef inhuren", url },
    ]),
    faqPageNode({ url, faqs: payrollPillarFaqs }),
    serviceNode({
      url,
      name: "Payroll chef inhuren via Chef & Serve",
      description:
        "Payroll-gebaseerde chef-staffing voor horecabedrijven in Amsterdam en de Randstad. Commis, chef de partie, sous chef, chef de cuisine, executive chef en specialisaties (banqueting, breakfast, roomservice, patissier) binnen 24 uur inzetbaar, 100% loondienst, Wet DBA 2026 compliant.",
      offers: [
        { name: "Commis de cuisine (payroll)", pricePerHour: site.pricing.commis },
        { name: "Chef de partie (payroll)", pricePerHour: site.pricing.chefDePartie },
        { name: "Sous chef (payroll)", pricePerHour: site.pricing.sousChef },
        { name: "Chef de cuisine (payroll)", pricePerHour: site.pricing.chefDeCuisine },
      ],
    }),
  );

  return (
    <>
      <JsonLd data={pageGraph} />

      <article className="mx-auto max-w-container px-4 py-section-y-mobile md:py-section-y-tablet lg:py-section-y">
        <TrustBanner />

        <header className="mb-8">
          <h1 className="mb-6">{TITLE}</h1>
          <p className="prose-cs">
            <strong>Payroll chef inhuren zonder ZZP-risico:</strong> Chef &amp; Serve levert
            ervaren chefs, sous chefs en keukenpersoneel volledig in loondienst via payroll —
            compliant met de Wet DBA 2026 en de Belastingdienst-handhaving die sinds 1 januari
            2025 weer actief is. Met een gescreend netwerk van 200+ horecaprofessionals
            (wekelijks groeiend met circa 50 nieuwe chefs) leveren wij binnen 24 uur de juiste
            match voor restaurants, hotels, catering en evenementen in Amsterdam en de volledige
            Randstad. Opgericht door Maarten Hogeveen — 20+ jaar chef in Amsterdamse topkeukens
            en eerder oprichter van het in 2025 gestopte JUSTHORECA — is Chef &amp; Serve vanaf
            dag één gebouwd als payroll-first staffing agency. Geen grijs gebied, geen
            constructies, geen naheffingen.
          </p>
        </header>

        <div className="prose-cs">
          <h2>Wat is payroll chef inhuren precies?</h2>
          <p>
            Payroll chef inhuren betekent: u schakelt een kok of chef in voor uw horecabedrijf,
            maar de medewerker staat niet bij u op de loonlijst. De payroll-agency — in dit geval
            Chef &amp; Serve — is de juridische werkgever. Wij dragen loonheffing, sociale
            premies, vakantiegeld, pensioenopbouw en het ziekterisico. U krijgt één factuur met
            een all-in uurtarief en houdt alle flexibiliteit die u van een uitzendbureau of
            freelance-constructie verwacht.
          </p>
          <p>
            Het verschil met ZZP is juridisch fundamenteel. Bij ZZP werkt de kok voor eigen
            rekening en risico. Bij payroll zit de kok in dienst bij de payroll-partij. Sinds de
            Belastingdienst de handhaving op schijnzelfstandigheid heeft hervat (1 januari 2025),
            is het verschil ook in de praktijk kritiek geworden. Een chef die op uw rooster
            staat, in uw keuken werkt, onder uw planning valt en volgens uw servicestandaarden
            werkt — dat is juridisch geen zelfstandige, ongeacht wat de overeenkomst zegt.
            Payroll is de structuur die die werkelijkheid weerspiegelt.
          </p>

          <h2>Waarom payroll in plaats van ZZP voor koks in 2026?</h2>
          <p>
            De Wet DBA (Deregulering Beoordeling Arbeidsrelaties) was jarenlang een papieren wet
            — de Belastingdienst handhaafde niet actief. Dat is in 2025 veranderd. De hernieuwde
            handhaving op schijnzelfstandigheid heeft drie concrete gevolgen voor uw
            horecabedrijf als u ZZP-koks inschakelt:
          </p>
          <ol>
            <li>
              <strong>Naheffing loonheffing en sociale premies:</strong> de Belastingdienst kan
              achteraf vaststellen dat de ZZP-relatie in praktijk een arbeidsrelatie was. Dan
              volgt naheffing over alle gewerkte uren, vaak met terugwerkende kracht tot vijf
              jaar.
            </li>
            <li>
              <strong>Werknemersclaim door de kok zelf:</strong> sinds maart 2026 kunnen
              lager-betaalde ZZP&apos;ers gemakkelijker een werknemersstatus afdwingen. Dat betekent
              claims op loon-doorbetaling bij ziekte, vakantiegeld, pensioen en
              ontslagvergoeding — allemaal met terugwerkende kracht.
            </li>
            <li>
              <strong>Boete en reputatieschade:</strong> in ernstige gevallen komen boetes
              bovenop de naheffing. Bij volumeklanten (hotelketens, cateringfirma&apos;s) is het
              risico op publicatie groot.
            </li>
          </ol>
          <p>
            Voor een kok die vijf diensten per week op uw rooster draait, is het ZZP-risico anno
            2026 juridisch gezien niet meer houdbaar. Payroll neemt dat risico volledig over.
            Chef &amp; Serve is de werkgever, u bent de opdrachtgever, de kok werkt compliant.
          </p>

          <h3>Wat ging er mis bij JUSTHORECA — en waarom Chef &amp; Serve payroll-first is</h3>
          <p>
            Maarten Hogeveen richtte in 2017 JUSTHORECA op, een ZZP-bemiddelingsplatform voor
            horecaprofessionals. Het werkte jarenlang prima. Maar met de hernieuwde handhaving
            vanaf 2025 stapelden de problemen: klanten kregen naheffingen, ZZP&apos;ers dienden
            werknemersclaims in, en het platform zelf werd aansprakelijk gesteld voor
            constructies die jaren eerder normaal waren. JUSTHORECA werd in 2025 stopgezet. Chef
            &amp; Serve is de compliant opvolger — geen ZZP, geen grijze zone, alles in
            loondienst. Wat JUSTHORECA overkwam, kan onze klanten niet overkomen.
          </p>

          <h2>Welke chef-rollen levert Chef &amp; Serve via payroll?</h2>
          <p>
            Het volledige spectrum aan keukenrollen voor Amsterdamse restaurants, hotels,
            cateringbedrijven en evenementen:
          </p>
          <ul>
            <li><strong>Commis de cuisine</strong> — instapniveau, vakopleiding afgerond, HACCP-gecertificeerd</li>
            <li><strong>Chef de partie</strong> — postspecialist (saucier, entremetier, garde manger, patissier, rôtisseur)</li>
            <li><strong>Sous chef</strong> — tweede-in-bevel, dagelijkse keukenleiding, brigade-coaching</li>
            <li><strong>Chef de cuisine</strong> — menu-ontwikkeling, inkoop, kwaliteitsbewaking</li>
            <li><strong>Executive chef</strong> — multi-outlet operaties, F&amp;B-strategie, banqueting-architectuur</li>
            <li><strong>Patissier / pastry chef</strong> — dessertkaart, bakkerij, afternoon tea, amenities</li>
            <li><strong>Banqueting chef</strong> — grote volumes, ballroom-service, event-planning</li>
            <li><strong>Breakfast chef / ontbijtkok</strong> — buffet en à la minute ontbijtservice</li>
            <li><strong>Roomservice kok</strong> — 24/7 operatie voor hotels</li>
          </ul>

          <h2>
            Payroll vs ZZP vs Uitzendbureau vs Vast dienstverband — welk model past bij welke
            situatie?
          </h2>
        </div>

        <ComparisonTable rows={standardComparisonRows} />

        <div className="prose-cs">
          <p>
            Voor de meeste horecabedrijven in 2026 is payroll het standaard-model voor flexibele
            bezetting. Het ZZP-model is voorbehouden aan écht onafhankelijke opdrachten
            (bijvoorbeeld een chef-consultant die menu-advies geeft, of een event-kok die een
            eigen concept neerzet op één avond).
          </p>

          <h2>Wat kost een payroll chef via Chef &amp; Serve?</h2>
          <p>
            Tarieven zijn all-in en afhankelijk van rol, ervaringsniveau, opdrachtduur, locatie
            en urgentie. Onze richtprijzen (Amsterdam, reguliere dagdienst, 2026):
          </p>
          <ul>
            <li><strong>Commis de cuisine</strong> — vanaf €{site.pricing.commis} per uur all-in</li>
            <li><strong>Chef de partie</strong> — vanaf €{site.pricing.chefDePartie} per uur all-in</li>
            <li><strong>Sous chef</strong> — vanaf €{site.pricing.sousChef} per uur all-in</li>
            <li><strong>Chef de cuisine</strong> — vanaf €{site.pricing.chefDeCuisine} per uur all-in</li>
            <li><strong>Executive chef</strong> — op aanvraag, segment-afhankelijk</li>
          </ul>
          <p>
            Alle tarieven zijn all-in: inclusief loonheffing, sociale premies, vakantiegeld,
            pensioenopbouw en het ziekterisico. Geen werkgeverslasten die achteraf bij uw
            horecabedrijf terechtkomen. Spoed (&lt;24 uur), nacht-, weekend- en feestdagdiensten
            kennen toeslagen conform de horeca-cao. Vraag een offerte op maat voor uw specifieke
            situatie.
          </p>

          <h2>Voor welke horeca-segmenten levert Chef &amp; Serve payroll-chefs?</h2>
          <p>
            <strong>Restaurants</strong> — van casual dining tot fine dining en Michelin-niveau.
            Voor de hogere segmenten werken wij met chefs uit ons premium-netwerk, met bewezen
            topkeuken-ervaring.
          </p>
          <p>
            <strong>Hotels</strong> — van boutique hotels tot internationale ketens. Specifiek
            voor hotelopdrachten leveren wij banqueting chefs, breakfast chefs en roomservice
            koks. Voor hotelketens en internationale hotelgroepen hebben wij een{" "}
            <Link href="/chef-inhuren-hotel-amsterdam/">aparte hotel-chef-gids</Link> met
            segment-specifieke informatie.
          </p>
          <p>
            <strong>Catering en events</strong> — volledige brigades voor bruiloften, corporate
            events, festivals en private parties. Inclusief bediening en event-coördinatie waar
            gewenst.
          </p>
          <p>
            <strong>Zakelijke catering</strong> — bedrijfsrestaurants, bankcatering, inflight
            catering. Operatie op locatie, vaak met strakke HACCP-eisen en volumes.
          </p>
          <p>
            Zoekt u specifiek een andere rol dan een chef? Kijk naar onze{" "}
            <Link href="/horeca-personeel-inhuren/">complete horeca-personeel-gids</Link> voor
            bediening, keukenhulpen en management. Voor vaste posities (werving en selectie)
            leveren wij ook <Link href="/hospitality-recruitment/">hospitality recruitment</Link>.
          </p>
        </div>

        <FAQAccordion
          faqs={payrollPillarFaqs}
          heading="Veelgestelde vragen over payroll chef inhuren"
        />

        <section className="mt-12 rounded bg-bg-gray p-8 text-center md:p-12">
          <h2 className="mb-4">Klaar om een payroll chef in te huren?</h2>
          <p className="mx-auto mb-6 max-w-prose text-ink-700">
            Stuur een e-mail, bel direct, of gebruik het contactformulier. Wij nemen binnen een
            uur contact op voor een korte briefing. Bij spoedopdrachten 7 dagen per week
            bereikbaar tussen 07:00 en 23:00.
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
