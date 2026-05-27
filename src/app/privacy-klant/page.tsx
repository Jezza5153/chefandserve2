import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacyverklaring · Klant-portaal",
};

/**
 * Public privacy page for klanten.
 *
 * V1: placeholder copy. LAWYER MUST REVIEW AND FILL IN.
 */
export default function PrivacyKlantPage() {
  return (
    <article className="mx-auto max-w-2xl px-6 py-12">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Privacy
      </p>
      <h1 className="mt-3 font-serif text-3xl text-ink-900 md:text-4xl">
        Privacyverklaring — Klant
      </h1>
      <p className="mt-2 text-xs text-ink-500">
        Versie: gegevensgebruik_klant_v1 · placeholder (concept)
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-ink-900">
        <Section title="Wie zijn wij?">
          Chef &amp; Serve B.V., uitzendbureau voor horecapersoneel.
          Wij verwerken zowel jouw gegevens (als opdrachtgever) als die
          van de chefs die wij aan je voorstellen.
          {/* TODO LAWYER: rol als verwerker vs verantwoordelijke per categorie data */}
        </Section>

        <Section title="Welke gegevens verwerken wij van jou?">
          <ul className="ml-6 list-disc space-y-1">
            <li>Bedrijfsgegevens: naam, KvK, BTW, factuuradres</li>
            <li>Contactpersoon: naam, e-mail, telefoonnummer</li>
            <li>Shifts: data, tijden, locaties, segmenten, tarieven</li>
            <li>Uren-ondertekening + akkoord-records</li>
            <li>Communicatie: e-mailgeschiedenis, notities</li>
          </ul>
        </Section>

        <Section title="Verwerkersovereenkomst (DPA)">
          Wij verwerken namens jou geen persoonsgegevens van jouw eigen
          klanten of werknemers — alleen onze chefs. Een verwerkers-
          overeenkomst is daarom niet automatisch nodig. Heb je wel een
          DPA-eis (bijv. hotelgroep-policy)? Neem contact op, dan
          ondertekenen we onze DPA-versie.
          {/* TODO LAWYER: precisie verwerker-vs-verantwoordelijke + DPA-voorwaarden */}
        </Section>

        <Section title="Hoe lang bewaren wij?">
          Factuuradministratie en gewerkte uren: 7 jaar (Belastingdienst).
          Audit + e-mailgeschiedenis: 2-7 jaar afhankelijk van type.
        </Section>

        <Section title="Jouw rechten">
          Inzage, correctie, verwijdering, of export op aanvraag. Reactie
          binnen 30 dagen. Sommige boekhoudgegevens moeten wij wettelijk
          7 jaar bewaren.
        </Section>

        <Section title="Contact">
          E-mail: <a href="mailto:privacy@chefandserve.nl" className="text-burgundy hover:underline">privacy@chefandserve.nl</a>
        </Section>
      </div>

      <p className="mt-12 rounded border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
        ⚠ Concept-versie. Definitieve tekst volgt na AVG-juridische review.
      </p>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-serif text-lg text-ink-900">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
