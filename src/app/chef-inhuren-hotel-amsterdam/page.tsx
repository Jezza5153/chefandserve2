import type { Metadata } from "next";
import Link from "next/link";
import { CTAButton } from "@/components/CTAButton";
import { ComparisonTable, standardComparisonRows } from "@/components/ComparisonTable";
import { FAQAccordion } from "@/components/FAQAccordion";
import { JsonLd } from "@/components/JsonLd";
import { TrustBanner } from "@/components/TrustBanner";
import { hotelPillarFaqs } from "@/lib/faqs";
import {
  articleNode,
  breadcrumbNode,
  buildGraph,
  faqPageNode,
  serviceNode,
  webpageNode,
} from "@/lib/schema";
import { site } from "@/lib/site";

const SLUG = "chef-inhuren-hotel-amsterdam";
const TITLE = "Chef inhuren voor uw hotel in Amsterdam — 100% payroll, geen ZZP-risico";
const DESCRIPTION =
  "Chef inhuren voor uw hotel in Amsterdam zonder ZZP-risico. 100% loondienst, 200+ chefs in netwerk, binnen 24 uur inzetbaar. Wet DBA 2026 compliant.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/${SLUG}/` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `/${SLUG}/` },
};

export default function HotelPillarPage() {
  const url = `${site.url}/${SLUG}/`;

  const pageGraph = buildGraph(
    articleNode({
      url,
      headline: TITLE,
      description: DESCRIPTION,
      datePublished: "2026-04-20",
      dateModified: new Date().toISOString(),
      image: `${site.url}/images/chef-hero.jpg`,
    }),
    webpageNode({ url, name: TITLE, description: DESCRIPTION }),
    breadcrumbNode([
      { name: "Home", url: `${site.url}/` },
      { name: "Chef inhuren hotel Amsterdam", url },
    ]),
    faqPageNode({ url, faqs: hotelPillarFaqs }),
    serviceNode({
      url,
      name: "Chef inhuren voor hotel in Amsterdam",
      description:
        "Payroll-based chef staffing for hotels in Amsterdam and Randstad. Commis, chef de partie, sous chef, executive chef and specialised hotel roles (banqueting, breakfast, roomservice) delivered within 24 hours, 100% compliant with Wet DBA 2026.",
      offers: [
        { name: "Commis de cuisine", pricePerHour: site.pricing.commis },
        { name: "Chef de partie", pricePerHour: site.pricing.chefDePartie },
        { name: "Sous chef", pricePerHour: site.pricing.sousChef },
        { name: "Chef de cuisine", pricePerHour: site.pricing.chefDeCuisine },
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
            <strong>Chef inhuren voor uw hotel in Amsterdam zonder ZZP-risico:</strong> Chef &amp; Serve
            levert ervaren koks, sous chefs en executive chefs volledig in loondienst via payroll —
            compliant met de Wet DBA 2026 en de handhaving die de Belastingdienst sinds 1 januari
            2025 weer actief voert. Met een netwerk van 200+ gescreende hospitality-professionals
            (wekelijks groeiend met circa 50 nieuwe chefs) leveren wij binnen 24 uur de juiste match
            voor banqueting, hotel breakfast, roomservice of à la carte service. Opgericht door
            Maarten Hogeveen — 20+ jaar chef in Amsterdamse topkeukens en oprichter van het in
            2025 gestopte JUSTHORECA — is Chef &amp; Serve vanaf dag één gebouwd als payroll-first
            staffing agency. Geen constructies, geen grijs gebied, geen naheffingen.
          </p>
        </header>

        <div className="prose-cs">
          <h2>Waarom kiezen hotels in 2026 voor payroll in plaats van ZZP?</h2>
          <p>
            Sinds 1 januari 2025 handhaaft de Belastingdienst weer volledig op
            schijnzelfstandigheid in Nederland. In maart 2026 is het kabinet nog een stap verder
            gegaan: lager-betaalde ZZP&apos;ers kunnen sindsdien makkelijker een werknemersstatus
            claimen. Voor een chef die vijf diensten per week op uw hotelrooster draait, onder uw
            planning, met uw ingrediënten, in uw keuken, en volgens uw servicestandaarden — is de
            ZZP-constructie juridisch praktisch niet meer houdbaar. De gezagsverhouding is evident,
            de Belastingdienst kan naheffen, en in een worst-case scenario kan de chef zelf een
            werknemersclaim indienen met terugwerkende kracht.
          </p>
          <p>
            De payroll-route via Chef &amp; Serve neemt dit risico volledig over. Onze chefs zijn
            bij ons in dienst, wij dragen loonheffing en sociale lasten af, wij lopen het
            juridische risico — niet uw hotel. U betaalt een transparant all-in uurtarief en houdt
            de volledige flexibiliteit die u van een uitzendbureau verwacht.
          </p>

          <h3>Wat ging er mis bij JUSTHORECA — en wat wij ervan geleerd hebben</h3>
          <p>
            Maarten Hogeveen richtte in 2017 JUSTHORECA op, een ZZP-bemiddelingsplatform voor
            horecaprofessionals in Amsterdam. Het werkte jarenlang uitstekend. Maar met de
            hernieuwde handhaving vanaf 2025 werd de business onhoudbaar: klanten kregen
            naheffingen, ZZP&apos;ers kregen werknemersclaims, en het platform zelf werd aansprakelijk
            gesteld voor constructies die jaren eerder logisch waren. JUSTHORECA werd in 2025
            gestopt. Chef &amp; Serve is de compliant opvolger — vanaf dag één gebouwd op
            loondienst, zodat wat JUSTHORECA overkwam, onze klanten nooit kan overkomen.
          </p>

          <h2>Welke chef-rollen levert Chef &amp; Serve specifiek voor hotels?</h2>
          <p>
            Hotelkeukens vragen om een breder rolspectrum dan standaard restaurants — denk aan
            24/7 bezetting, banqueting-pieken, breakfast-brigade en roomservice-flexibiliteit. Wij
            leveren het volledige keukenspectrum plus de hotel-specifieke specialismen:
          </p>
          <ul>
            <li><strong>Commis de cuisine</strong> — instapniveau, vakopleiding afgerond</li>
            <li>
              <strong>Chef de partie</strong> — specialist per post (saucier, entremetier, garde
              manger, patissier)
            </li>
            <li>
              <strong>Sous chef</strong> — tweede-in-bevel, dagelijkse operationele leiding
            </li>
            <li>
              <strong>Chef de cuisine</strong> — verantwoordelijk voor menu, inkoop,
              brigade-coaching
            </li>
            <li>
              <strong>Executive chef</strong> — multi-outlet hotels, F&amp;B-strategie,
              banqueting-ontwerp
            </li>
            <li><strong>Banqueting chef</strong> — grote volumes, ballroom-service, event-planning</li>
            <li>
              <strong>Breakfast chef / ontbijtkok</strong> — buffet, à la minute, early-morning
              shift
            </li>
            <li>
              <strong>Roomservice kok</strong> — 24/7 operatie, volledige menukaart, efficiency
            </li>
            <li>
              <strong>Patissier / pastry chef</strong> — bakery, dessert, high tea, amenities
            </li>
          </ul>
          <p>
            Alle chefs in ons netwerk zijn gescreend op vakbekwaamheid, HACCP-kennis,
            hotelervaring (banqueting en à la carte) en interpersoonlijke match met ons
            premium-segment. Wij matchen persoonlijk — geen anoniem platform, geen random pooling.
          </p>

          <h2>
            Payroll versus ZZP versus Uitzend versus Vast: wat past bij welke situatie?
          </h2>
        </div>

        <ComparisonTable rows={standardComparisonRows} />

        <div className="prose-cs">
          <h2>Hoe werkt een chef inhuren bij Chef &amp; Serve in de praktijk?</h2>

          <h3>1. Aanvraag</h3>
          <p>
            U stuurt een e-mail of belt direct met{" "}
            <a href={`tel:${site.phone}`}>{site.phoneDisplay}</a>. U geeft aan: welke rol (commis
            tot executive chef), welke periode (losse dienst / week / seizoen / vast), welk
            segment (casual dining, fine dining, banqueting, hotel breakfast) en eventuele
            specifieke eisen (HACCP-certificaten, ervaring met specifieke keuken, talen). Ook
            spoedaanvragen nemen wij in behandeling — wij streven naar een terugkoppeling binnen
            een uur.
          </p>

          <h3>2. Matching</h3>
          <p>
            Uit ons netwerk van 200+ professionals selecteren wij persoonlijk 1-3 kandidaten die
            passen bij uw situatie. Geen anonieme pool — wij kennen onze mensen. Voor
            premium-opdrachten checken wij ervaring, referenties en cultuur-match.
          </p>

          <h3>3. Bevestiging</h3>
          <p>
            Binnen 4-24 uur (afhankelijk van urgentie en specialisatie) bevestigen wij de
            plaatsing. U ontvangt profiel, cv en (bij lopende opdracht) contactgegevens voor
            directe communicatie.
          </p>

          <h3>4. Inzet</h3>
          <p>
            Onze chef komt op de afgesproken datum/tijd. Volledig in loondienst bij Chef &amp;
            Serve — wij zorgen voor loonheffing, sociale lasten, vakantiegeld en ziektevervanging.
            U hoeft alleen de gewerkte uren te beoordelen en factuur af te rekenen.
          </p>

          <h3>5. Bij uitval</h3>
          <p>
            Als onze chef onverwacht uitvalt (ziekte, no-show, overmacht), is vervanging onze
            verantwoordelijkheid. Wij zoeken direct een vervanger uit ons netwerk. U betaalt alleen
            voor daadwerkelijk gewerkte uren.
          </p>

          <h2>Wat kost een chef inhuren via Chef &amp; Serve voor een hotel?</h2>
          <p>
            Tarieven zijn afhankelijk van rol, ervaringsniveau, opdrachtduur, locatie en urgentie.
            Een commis kost uiteraard minder dan een executive chef, en een geplande weekopdracht
            minder dan een spoedklus voor vanavond. Wat wel altijd geldt: onze tarieven zijn
            all-in — inclusief loonheffing, sociale lasten, vakantiegeld, pensioenopbouw en
            ziekterisico. Geen verborgen kosten, geen naheffing achteraf, geen werkgeverslasten
            die nog bij uw hotel terechtkomen.
          </p>
          <p>Ter indicatie (Amsterdam, reguliere dagdienst, 2026):</p>
          <ul>
            <li><strong>Commis de cuisine</strong> — vanaf €{site.pricing.commis} per uur all-in</li>
            <li><strong>Chef de partie</strong> — vanaf €{site.pricing.chefDePartie} per uur all-in</li>
            <li><strong>Sous chef</strong> — vanaf €{site.pricing.sousChef} per uur all-in</li>
            <li><strong>Chef de cuisine</strong> — vanaf €{site.pricing.chefDeCuisine} per uur all-in</li>
            <li><strong>Executive chef</strong> — op aanvraag, afhankelijk van hotel-segment</li>
          </ul>
          <p>
            Spoedklussen (&lt;24 uur), nacht- en weekenddiensten, en banqueting-pieken worden tegen
            een toeslag gefactureerd. Vraag een offerte op maat — wij geven binnen 30 minuten een
            indicatie.
          </p>

          <h2>Waarom Chef &amp; Serve en niet een ander horeca uitzendbureau?</h2>
          <p>
            Er zijn veel horeca uitzendbureaus in Amsterdam. Een paar die qua model op ons lijken,
            een groot aantal dat volumespel bedrijft of nog altijd ZZP-constructies verkoopt. Wat
            Chef &amp; Serve onderscheidt:
          </p>
          <ol>
            <li>
              <strong>Authentiek payroll-first.</strong> Niet als gevolg van regelgeving omgezet,
              maar vanaf dag één als compliant opgezet. Na JUSTHORECA was er voor ons geen andere
              keuze.
            </li>
            <li>
              <strong>Chef-expertise aan de top.</strong> Maarten Hogeveen heeft 20+ jaar als chef
              gewerkt in Amsterdamse topkeukens (Lute, Vijff Vlieghen, Swarte Walvis, Mario,
              Chefstable). Hij weet welke chef past in welk type keuken — op niveau, op stijl, op
              karakter.
            </li>
            <li>
              <strong>Premium, niet massaal.</strong> Wij werken persoonlijk. Elke plaatsing wordt
              door een mens gematcht, niet door een platform-algoritme. Voor 4- en 5-sterren
              hotels maakt dat het verschil.
            </li>
            <li>
              <strong>Transparant over compliance.</strong> Wij leggen bij elke opdracht uit
              waarom onze structuur juridisch houdt. Geen vage constructies, geen &quot;we lossen
              het wel op&quot;.
            </li>
            <li>
              <strong>Actief in de volledige Randstad.</strong> Amsterdam is onze thuisbasis, maar
              wij leveren ook in Den Haag, Rotterdam en Utrecht.
            </li>
          </ol>
        </div>

        <FAQAccordion
          faqs={hotelPillarFaqs}
          heading="Veelgestelde vragen over chef inhuren voor hotels in Amsterdam"
        />

        <section className="mt-12 rounded bg-bg-gray p-8 text-center md:p-12">
          <h2 className="mb-4">Klaar om een chef voor uw hotel in te huren?</h2>
          <p className="mx-auto mb-6 max-w-prose text-ink-700">
            Stuur een mail, bel direct, of gebruik het contactformulier. Wij nemen binnen een uur
            contact op voor een korte briefing. Bij spoedklussen 7 dagen per week bereikbaar.
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
          <p className="mt-6 text-sm text-ink-700">
            <Link
              href="/payroll-chef-inhuren/"
              className="text-burgundy underline-offset-4 hover:underline"
            >
              Of lees onze payroll-gids
            </Link>{" "}
            voor de juridische compliance-route.
          </p>
        </section>
      </article>
    </>
  );
}
