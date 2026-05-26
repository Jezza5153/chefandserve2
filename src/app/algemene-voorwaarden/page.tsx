import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { PageHero } from "@/components/PageHero";
import {
  breadcrumbNode,
  buildGraph,
  webpageNode,
} from "@/lib/schema";
import { site } from "@/lib/site";

const SLUG = "algemene-voorwaarden";
const TITLE = "Algemene Voorwaarden — Chef & Serve";
const DESCRIPTION =
  "Algemene voorwaarden van Chef & Serve, horeca uitzendbureau Amsterdam. Bepalingen voor inhuur, levering, betaling en aansprakelijkheid.";

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
      { name: "Algemene voorwaarden", url },
    ]),
  );

  return (
    <>
      <JsonLd data={pageGraph} />

      <PageHero
        eyebrow="Juridisch"
        title="Algemene voorwaarden"
        intro={<p className="text-sm">Versie 1.0 — geldig vanaf 26 mei 2026</p>}
        image="/images/restaurant-interior.jpg"
        imageAlt="Chef & Serve"
        size="compact"
      />

      <article className="mx-auto max-w-3xl px-4 py-20 md:py-28">
        <section className="prose-cs">
          <h2>1. Definities</h2>
          <ul>
            <li>
              <strong>Chef &amp; Serve</strong>: de onderneming Chef &amp; Serve, gevestigd te {site.address.street}, {site.address.postalCode} {site.address.locality}, ingeschreven bij de Kamer van Koophandel onder nummer {site.kvk}.
            </li>
            <li>
              <strong>Opdrachtgever</strong>: de natuurlijke persoon of rechtspersoon die met Chef &amp; Serve een overeenkomst aangaat tot het inhuren van personeel.
            </li>
            <li>
              <strong>Medewerker</strong>: de natuurlijke persoon die op basis van een arbeidsovereenkomst met Chef &amp; Serve werkzaamheden verricht ten behoeve van een Opdrachtgever.
            </li>
            <li>
              <strong>Overeenkomst</strong>: elke schriftelijke of mondelinge afspraak tussen Chef &amp; Serve en Opdrachtgever inzake het ter beschikking stellen van personeel.
            </li>
          </ul>

          <h2>2. Toepasselijkheid</h2>
          <p>
            Deze algemene voorwaarden zijn van toepassing op alle aanbiedingen,
            offertes en overeenkomsten tussen Chef &amp; Serve en Opdrachtgever,
            tenzij schriftelijk anders is overeengekomen. Eventuele inkoop- of
            andere voorwaarden van Opdrachtgever worden uitdrukkelijk van de
            hand gewezen.
          </p>

          <h2>3. Werkwijze en aard van de dienst</h2>
          <p>
            Chef &amp; Serve stelt Medewerkers ter beschikking aan Opdrachtgever
            op basis van een payroll-model. Chef &amp; Serve is en blijft
            juridisch werkgever van de Medewerker. De Medewerker werkt onder
            leiding en toezicht van Opdrachtgever, conform de instructies die
            Opdrachtgever in redelijkheid geeft.
          </p>
          <p>
            Chef &amp; Serve werkt uitsluitend met Medewerkers in loondienst.
            Er is geen sprake van ZZP- of freelance-constructies. De inhuur
            voldoet aan de bepalingen van de Wet DBA (Deregulering Beoordeling
            Arbeidsrelaties) en latere wetgeving.
          </p>

          <h2>4. Totstandkoming van de overeenkomst</h2>
          <p>
            Een overeenkomst komt tot stand door schriftelijke bevestiging van
            Chef &amp; Serve (per e-mail of opdrachtbevestiging). Mondelinge
            afspraken worden door Chef &amp; Serve bevestigd voordat de
            Medewerker wordt ingezet.
          </p>

          <h2>5. Tarieven en facturatie</h2>
          <p>
            De geldende tarieven worden bij elke opdracht schriftelijk
            vastgelegd. Tarieven zijn all-in (loonheffing, sociale lasten,
            vakantiegeld, ziekterisico) en exclusief btw.
          </p>
          <p>
            Facturatie vindt plaats per week of per maand, op basis van de
            werkelijk gewerkte uren zoals vastgelegd in de urenregistratie.
            Betaling dient binnen 14 dagen na factuurdatum te geschieden,
            tenzij anders schriftelijk overeengekomen.
          </p>
          <p>
            Bij niet-tijdige betaling is Opdrachtgever na ingebrekestelling
            wettelijke handelsrente verschuldigd, evenals eventuele
            incassokosten conform de Wet Incassokosten.
          </p>

          <h2>6. Annulering</h2>
          <ul>
            <li>
              <strong>Annulering meer dan 48 uur voor aanvang</strong>: kosteloos
            </li>
            <li>
              <strong>Annulering tussen 48 en 24 uur voor aanvang</strong>: 50% van het overeengekomen tarief voor de geplande uren
            </li>
            <li>
              <strong>Annulering binnen 24 uur voor aanvang</strong>: 100% van het overeengekomen tarief voor de geplande uren
            </li>
          </ul>

          <h2>7. Urenregistratie en goedkeuring</h2>
          <p>
            De werkelijk gewerkte uren worden door de Medewerker geregistreerd
            en door of namens Opdrachtgever bevestigd. Bij ontbreken van
            bezwaar binnen 5 werkdagen na ontvangst van de urenstaat worden de
            uren als geaccordeerd beschouwd.
          </p>

          <h2>8. Verplichtingen Opdrachtgever</h2>
          <ul>
            <li>Zorg voor een veilige werkomgeving conform Arbo-wetgeving</li>
            <li>Verstrek tijdig de noodzakelijke informatie, instructies en werkkleding (indien specifiek)</li>
            <li>Behandel de Medewerker met respect en conform de algemeen geldende normen in de horeca</li>
            <li>Neem de Medewerker niet rechtstreeks in dienst zonder voorafgaande schriftelijke toestemming van Chef &amp; Serve (zie artikel 11)</li>
          </ul>

          <h2>9. Vervanging en ziekte</h2>
          <p>
            Bij ziekte of overmacht van een Medewerker spant Chef &amp; Serve
            zich in om binnen redelijke termijn een vervanger te leveren.
            Indien geen vervanger beschikbaar is, vervalt de
            betalingsverplichting voor de niet-geleverde uren.
          </p>

          <h2>10. Aansprakelijkheid</h2>
          <p>
            Chef &amp; Serve is uitsluitend aansprakelijk voor directe schade
            die het gevolg is van een toerekenbare tekortkoming. De
            aansprakelijkheid is beperkt tot het bedrag dat in het betreffende
            geval onder de aansprakelijkheidsverzekering wordt uitgekeerd, en
            in elk geval tot maximaal het factuurbedrag van de opdracht waarop
            de schade betrekking heeft.
          </p>
          <p>
            Aansprakelijkheid voor indirecte schade, gevolgschade, gederfde
            winst of bedrijfsschade is uitgesloten.
          </p>

          <h2>11. Overname van Medewerker</h2>
          <p>
            Indien Opdrachtgever een door Chef &amp; Serve geleverde Medewerker
            binnen 12 maanden na de eerste plaatsing in dienst neemt of via
            een andere weg structureel inzet zonder tussenkomst van Chef &amp;
            Serve, is Opdrachtgever een vergoeding verschuldigd van € 5.000,–
            exclusief btw, tenzij anders schriftelijk overeengekomen.
          </p>

          <h2>12. Geheimhouding</h2>
          <p>
            Partijen behandelen alle bedrijfsgevoelige informatie die zij van
            elkaar ontvangen vertrouwelijk en gebruiken deze uitsluitend voor
            het doel waarvoor zij is verstrekt.
          </p>

          <h2>13. Persoonsgegevens</h2>
          <p>
            Verwerking van persoonsgegevens vindt plaats conform ons{" "}
            <a href="/privacybeleid/" className="text-burgundy underline-offset-4 hover:underline">privacybeleid</a>{" "}
            en de Algemene Verordening Gegevensbescherming (AVG).
          </p>

          <h2>14. Toepasselijk recht en geschillen</h2>
          <p>
            Op alle overeenkomsten tussen Chef &amp; Serve en Opdrachtgever is
            Nederlands recht van toepassing. Geschillen worden bij voorkeur in
            onderling overleg opgelost. Indien dat niet lukt, worden geschillen
            voorgelegd aan de bevoegde rechter in het arrondissement Amsterdam.
          </p>

          <h2>15. Wijzigingen voorwaarden</h2>
          <p>
            Chef &amp; Serve behoudt zich het recht voor deze algemene
            voorwaarden te wijzigen. De meest recente versie staat op deze
            pagina. Wijzigingen worden minimaal 30 dagen voor inwerkingtreding
            aangekondigd aan bestaande Opdrachtgevers.
          </p>

          <h2>Contact</h2>
          <p>
            Vragen over deze voorwaarden? Neem contact op via{" "}
            <a href={`mailto:${site.email}`} className="text-burgundy underline-offset-4 hover:underline">
              {site.email}
            </a>{" "}
            of telefoonnummer {site.phoneDisplay}.
          </p>
        </section>
      </article>
    </>
  );
}
