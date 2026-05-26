import type { Metadata } from "next";
import {
  ServicePage,
  HotelPillarLink,
  PayrollPillarLink,
} from "@/components/ServicePage";
import { site } from "@/lib/site";

const SLUG = "horeca-personeel-inhuren";
const TITLE = "Horeca Personeel Inhuren — 100% loondienst, Amsterdam";
const DESCRIPTION =
  "100% loondienst horeca personeel Amsterdam. 200+ koks en chefs, geen ZZP-risico, Wet DBA 2026 compliant. Levering binnen 24 uur.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/${SLUG}/` },
};

export default function Page() {
  return (
    <ServicePage
      data={{
        slug: SLUG,
        heroImage: "/images/service-chefs.jpg",
        heroEyebrow: "Horeca personeel",
        title: "Horeca Personeel Inhuren in Amsterdam — Compleet Team in Loondienst",
        breadcrumbLabel: "Horeca personeel inhuren",
        description: DESCRIPTION,
        intro: (
          <p>
            <strong>Horeca personeel inhuren in Amsterdam zonder ZZP-risico:</strong> Chef &amp;
            Serve levert het complete horecateam — koks, bediening, keukenhulpen en management —
            volledig in loondienst via payroll. Met een netwerk van 200+ gescreende
            hospitality-professionals (wekelijks groeiend met circa 50 nieuwe medewerkers)
            leveren wij binnen 24 uur de juiste match voor uw restaurant, hotel of evenement.
            100% Wet DBA 2026 compliant.
          </p>
        ),
        body: (
          <>
            <h2>Welk horeca personeel kunnen wij leveren?</h2>
            <ul>
              <li><strong>Bediening</strong> — runners, host/hostess, ervaren bediening voor casual tot fine dining</li>
              <li><strong>Keuken</strong> — keukenhulp, commis, chef de partie, sous chef, chef de cuisine, executive chef</li>
              <li><strong>Specialisten</strong> — patissier, banqueting chef, breakfast chef, roomservice kok</li>
              <li><strong>Catering</strong> — complete event-brigades inclusief coördinatie</li>
              <li><strong>Permanent</strong> — werving en selectie voor vaste posities</li>
            </ul>

            <h2>Waarom Chef &amp; Serve voor uw horecapersoneel?</h2>
            <p>
              Wij combineren drie dingen die in de markt zelden samenvallen: <strong>100% payroll
              compliance</strong> (geen Wet DBA-risico), <strong>persoonlijke matching</strong>
              {" "}(elke plaatsing handmatig beoordeeld) en <strong>premium-kwaliteit netwerk</strong>
              {" "}(geen anoniem platform). Oprichter Maarten Hogeveen heeft 20+ jaar in Amsterdamse
              topkeukens gewerkt — hij kent het verschil tussen een chef voor casual dining en
              een chef voor fine dining, en matcht daarop.
            </p>

            <h2>Hoe werkt het?</h2>
            <ol>
              <li>Stuur een aanvraag — rol, periode, segment, urgentie</li>
              <li>Wij matchen persoonlijk uit ons netwerk van 200+ pros</li>
              <li>Bevestiging binnen 4-24 uur, afhankelijk van urgentie</li>
              <li>Inzet op uw locatie — wij blijven juridisch werkgever</li>
              <li>Bij ziekte of uitval: vervanging is onze verantwoordelijkheid</li>
            </ol>

            <h2>Tarieven</h2>
            <p>
              All-in payroll-tarieven (inclusief loonheffing, sociale lasten, vakantiegeld,
              ziekterisico):
            </p>
            <ul>
              <li>Bediening — vanaf €{site.pricing.bediening}/uur</li>
              <li>Keukenhulp — vanaf €{site.pricing.keukenhulp}/uur</li>
              <li>Chef de partie — vanaf €{site.pricing.chefDePartie}/uur</li>
              <li>Sous chef — vanaf €{site.pricing.sousChef}/uur</li>
              <li>Chef de cuisine — vanaf €{site.pricing.chefDeCuisine}/uur</li>
            </ul>
          </>
        ),
        offers: [
          { name: "Bediening", pricePerHour: site.pricing.bediening },
          { name: "Keukenhulp", pricePerHour: site.pricing.keukenhulp },
          { name: "Chef de partie", pricePerHour: site.pricing.chefDePartie },
        ],
        pillarLink: (
          <>
            <HotelPillarLink />
            <PayrollPillarLink />
          </>
        ),
        cta: {
          heading: "Horeca personeel nodig?",
          body: "Stuur een mail of bel — binnen een uur reageren wij voor een korte briefing en de juiste match.",
        },
      }}
    />
  );
}
