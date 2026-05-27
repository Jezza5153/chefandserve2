import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacyverklaring · Chef-portaal",
};

/**
 * Public privacy page for chefs.
 *
 * V1: placeholder copy. LAWYER MUST REVIEW AND FILL IN before
 * AVG_CONSENT_ENFORCED is flipped on in production.
 *
 * TODO LAWYER: replace each <!-- TODO --> block.
 */
export default function PrivacyChefPage() {
  return (
    <article className="mx-auto max-w-2xl px-6 py-12">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Privacy
      </p>
      <h1 className="mt-3 font-serif text-3xl text-ink-900 md:text-4xl">
        Privacyverklaring — Chef
      </h1>
      <p className="mt-2 text-xs text-ink-500">
        Versie: gegevensgebruik_chef_v1 · placeholder (concept)
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-ink-900">
        <Section title="Wie zijn wij?">
          Chef &amp; Serve B.V., gevestigd te Amsterdam. Wij zijn een
          uitzendbureau voor premium horecapersoneel.
          {/* TODO LAWYER: officiële juridische naam + KvK + RSIN + adres */}
        </Section>

        <Section title="Welke gegevens verwerken wij?">
          <ul className="ml-6 list-disc space-y-1">
            <li>Identiteit: naam, e-mail, telefoonnummer, geboortedatum</li>
            <li>Werkgegevens: vakniveau, ervaring, talen, specialteiten</li>
            <li>Beschikbaarheid + locatie</li>
            <li>Documenten: CV, certificaten, ID-bewijs, foto</li>
            <li>Gewerkte uren + uitbetalingsstatus</li>
            <li>Communicatie: e-mailgeschiedenis, notities</li>
          </ul>
          {/* TODO LAWYER: BSN expliciet benoemen of weglaten, wettelijke grondslag */}
        </Section>

        <Section title="Waarvoor gebruiken wij je gegevens?">
          Planning, communicatie, uitbetaling, administratie. Wij verkopen
          je gegevens nooit aan derden. Klanten zien alleen jouw naam,
          vakniveau, ervaring en de documenten die jij/wij hebben
          aangevinkt als "klant mag zien".
          {/* TODO LAWYER: doelbinding per categorie + wettelijke grondslag (uitvoering overeenkomst, gerechtvaardigd belang, wettelijke verplichting) */}
        </Section>

        <Section title="Hoe lang bewaren wij je gegevens?">
          <ul className="ml-6 list-disc space-y-1">
            <li>Administratie + uitbetaling: 7 jaar (Belastingdienst)</li>
            <li>ID-bewijs: zolang je account actief is + 1 jaar</li>
            <li>Audit log: 7 jaar</li>
            <li>Communicatie: 2 jaar</li>
          </ul>
          {/* TODO LAWYER: alle bewaartermijnen per categorie met grondslag */}
        </Section>

        <Section title="Jouw rechten">
          Je kunt op elk moment inzage, correctie, verwijdering, of een
          export van je gegevens vragen via{" "}
          <code className="font-mono text-xs">/chef/privacy</code> in het
          portaal. Wij reageren binnen 30 dagen (AVG art. 12(3)). Sommige
          gegevens moeten wij wettelijk bewaren — die kunnen wij niet
          verwijderen tot de wettelijke termijn is verlopen.
          {/* TODO LAWYER: AP klacht-recht + DPO contactgegevens als aanwezig */}
        </Section>

        <Section title="Contact">
          {/* TODO LAWYER: officieel contactadres + DPO */}
          E-mail: <a href="mailto:privacy@chefandserve.nl" className="text-burgundy hover:underline">privacy@chefandserve.nl</a>
        </Section>
      </div>

      <p className="mt-12 rounded border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
        ⚠ Concept-versie. De definitieve tekst wordt door een AVG-jurist
        ingevuld voordat de "verplicht akkoord" feature live gaat.
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
