import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import {
  breadcrumbNode,
  buildGraph,
  webpageNode,
} from "@/lib/schema";
import { site } from "@/lib/site";

const SLUG = "privacybeleid";
const TITLE = "Privacybeleid — Chef & Serve";
const DESCRIPTION =
  "Hoe Chef & Serve persoonsgegevens verwerkt: welke gegevens wij verzamelen, waarvoor wij ze gebruiken en welke rechten u heeft. AVG-compliant.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/${SLUG}/` },
  robots: { index: true, follow: true },
};

export default function Page() {
  const url = `${site.url}/${SLUG}/`;
  const pageGraph = buildGraph(
    webpageNode({ url, name: TITLE, description: DESCRIPTION }),
    breadcrumbNode([
      { name: "Home", url: `${site.url}/` },
      { name: "Privacybeleid", url },
    ]),
  );

  return (
    <>
      <JsonLd data={pageGraph} />

      <article className="mx-auto max-w-container px-4 py-section-y-mobile md:py-section-y-tablet lg:py-section-y">
        <header className="mb-12">
          <h1 className="mb-6">Privacybeleid</h1>
          <p className="prose-cs text-sm text-ink-700">
            Laatst bijgewerkt: 26 mei 2026
          </p>
        </header>

        <section className="prose-cs">
          <p>
            Chef &amp; Serve hecht groot belang aan de bescherming van uw
            persoonsgegevens. Wij verwerken persoonsgegevens conform de Algemene
            Verordening Gegevensbescherming (AVG / GDPR). In dit privacybeleid
            leggen wij uit welke gegevens wij verzamelen, waarvoor wij ze
            gebruiken en welke rechten u heeft.
          </p>

          <h2>1. Verwerkingsverantwoordelijke</h2>
          <p>
            Chef &amp; Serve, gevestigd te {site.address.street},{" "}
            {site.address.postalCode} {site.address.locality}, ingeschreven bij
            de Kamer van Koophandel onder nummer {site.kvk}, is de
            verwerkingsverantwoordelijke. Voor vragen of verzoeken kunt u
            contact opnemen via{" "}
            <a href={`mailto:${site.email}`} className="text-burgundy underline-offset-4 hover:underline">
              {site.email}
            </a>{" "}
            of telefoonnummer {site.phoneDisplay}.
          </p>

          <h2>2. Welke persoonsgegevens verwerken wij?</h2>
          <p>Afhankelijk van uw relatie met ons (klant, kandidaat-werknemer, websitebezoeker) verwerken wij:</p>
          <ul>
            <li>
              <strong>Contactgegevens</strong> — naam, e-mailadres, telefoonnummer, bedrijfsnaam, adres
            </li>
            <li>
              <strong>Sollicitatiegegevens</strong> — cv, motivatiebrief, werkervaring, opleiding, beschikbaarheid, eventueel diploma's en certificaten
            </li>
            <li>
              <strong>Werknemersgegevens</strong> — BSN, identiteitsbewijs, bankgegevens, salarisgegevens (alleen voor werknemers in loondienst)
            </li>
            <li>
              <strong>Klantgegevens</strong> — KvK-nummer, btw-nummer, factuurgegevens, contactpersonen
            </li>
            <li>
              <strong>Communicatiegegevens</strong> — inhoud van mails, telefoongesprekken (indien expliciet aangegeven), formulieren
            </li>
            <li>
              <strong>Websitegegevens</strong> — IP-adres (geanonimiseerd), browsertype, bezochte pagina's, verblijftijd (via Google Analytics, indien u akkoord gaat)
            </li>
          </ul>

          <h2>3. Waarvoor gebruiken wij uw gegevens?</h2>
          <ul>
            <li>
              <strong>Het leveren van onze dienst</strong> — matching tussen
              klant en hospitality-professional, contractbeheer, facturatie
            </li>
            <li>
              <strong>Werkgeverschap</strong> — loonbetaling, sociale lasten,
              ziekteverzuim, vakantieregistratie (voor onze werknemers)
            </li>
            <li>
              <strong>Communicatie</strong> — beantwoorden van vragen,
              opvolgen van briefings, informeren over diensten
            </li>
            <li>
              <strong>Wettelijke verplichtingen</strong> — fiscale en
              administratieve bewaarplicht
            </li>
            <li>
              <strong>Website verbeteren</strong> — anonieme statistieken om
              de website te optimaliseren
            </li>
          </ul>

          <h2>4. Rechtsgronden</h2>
          <p>Wij verwerken uw gegevens op basis van:</p>
          <ul>
            <li>
              <strong>Uitvoering van een overeenkomst</strong> — voor klanten en werknemers
            </li>
            <li>
              <strong>Wettelijke verplichting</strong> — voor fiscale en sociale-zekerheidsplichten
            </li>
            <li>
              <strong>Gerechtvaardigd belang</strong> — voor commerciële communicatie en website-analyse
            </li>
            <li>
              <strong>Toestemming</strong> — voor analytics-cookies en sollicitatieprocedures
            </li>
          </ul>

          <h2>5. Met wie delen wij uw gegevens?</h2>
          <p>Wij delen uw gegevens alleen met derden wanneer dit noodzakelijk is:</p>
          <ul>
            <li><strong>Loonadministrateur en accountant</strong> — voor loonverwerking en boekhouding</li>
            <li><strong>Klanten</strong> — voor wie u als werknemer wordt ingezet (alleen relevante gegevens)</li>
            <li><strong>Belastingdienst en UWV</strong> — voor wettelijke verplichtingen</li>
            <li><strong>Hostingproviders en e-mailproviders</strong> — voor het functioneren van onze infrastructuur (verwerkersovereenkomsten in place)</li>
          </ul>
          <p>Wij verkopen uw gegevens nooit aan derden.</p>

          <h2>6. Bewaartermijnen</h2>
          <ul>
            <li><strong>Sollicitatiegegevens</strong> — 4 weken na afsluiten procedure, tenzij u toestemming geeft voor opname in onze database (maximaal 1 jaar)</li>
            <li><strong>Klantgegevens</strong> — gedurende de overeenkomst, daarna 7 jaar (fiscale bewaarplicht)</li>
            <li><strong>Werknemersgegevens</strong> — gedurende dienstverband, daarna 7 jaar (loonadministratie) of 5 jaar (overige gegevens)</li>
            <li><strong>Marketinggegevens</strong> — totdat u zich uitschrijft of bezwaar maakt</li>
            <li><strong>Analytics-gegevens</strong> — maximaal 14 maanden, geanonimiseerd</li>
          </ul>

          <h2>7. Beveiliging</h2>
          <p>
            Wij hebben passende technische en organisatorische maatregelen
            genomen om uw gegevens te beschermen tegen verlies, misbruik of
            ongeoorloofde toegang. Dit omvat versleutelde opslag,
            toegangscontroles, en periodieke veiligheidsbeoordelingen.
          </p>

          <h2>8. Uw rechten</h2>
          <p>U heeft op grond van de AVG de volgende rechten:</p>
          <ul>
            <li><strong>Recht op inzage</strong> — opvragen welke gegevens wij van u hebben</li>
            <li><strong>Recht op rectificatie</strong> — onjuiste gegevens laten corrigeren</li>
            <li><strong>Recht op verwijdering</strong> — uw gegevens laten wissen (uitzonderingen mogelijk wegens wettelijke bewaarplicht)</li>
            <li><strong>Recht op beperking</strong> — verwerking tijdelijk laten stilleggen</li>
            <li><strong>Recht op dataportabiliteit</strong> — uw gegevens in een leesbaar formaat ontvangen</li>
            <li><strong>Recht van bezwaar</strong> — bezwaar maken tegen verwerking op basis van gerechtvaardigd belang</li>
            <li><strong>Recht om toestemming in te trekken</strong> — voor verwerkingen waarvoor u toestemming heeft gegeven</li>
          </ul>
          <p>
            Stuur uw verzoek naar{" "}
            <a href={`mailto:${site.email}`} className="text-burgundy underline-offset-4 hover:underline">
              {site.email}
            </a>
            . Wij reageren binnen 4 weken.
          </p>

          <h2>9. Klachten</h2>
          <p>
            Heeft u een klacht over de manier waarop wij met uw gegevens omgaan?
            Neem dan eerst contact met ons op. U heeft daarnaast het recht om
            een klacht in te dienen bij de{" "}
            <a
              href="https://autoriteitpersoonsgegevens.nl"
              target="_blank"
              rel="noopener noreferrer"
              className="text-burgundy underline-offset-4 hover:underline"
            >
              Autoriteit Persoonsgegevens
            </a>
            .
          </p>

          <h2>10. Cookies</h2>
          <p>
            Onze website gebruikt functionele en (mits toestemming verleend)
            analytische cookies. Functionele cookies zijn noodzakelijk voor
            een goede werking van de website. Analytische cookies (Google
            Analytics) gebruiken wij alleen na uw expliciete toestemming, om
            anonieme bezoekersstatistieken te verzamelen.
          </p>

          <h2>11. Wijzigingen</h2>
          <p>
            Wij kunnen dit privacybeleid van tijd tot tijd aanpassen. De meest
            recente versie staat altijd op deze pagina. Wij raden u aan dit
            beleid periodiek te raadplegen.
          </p>
        </section>
      </article>
    </>
  );
}
