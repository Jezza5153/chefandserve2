import type { Metadata } from "next";
import { ClosingCTA } from "@/components/ClosingCTA";
import { JsonLd } from "@/components/JsonLd";
import { PageHero, SectionLabel } from "@/components/PageHero";
import { SplitSection } from "@/components/SplitSection";
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

const benefits = [
  {
    label: "Zekerheid",
    title: "Loondienst-contract",
    body:
      "Vast loon, pensioenopbouw, vakantiegeld en doorbetaling bij ziekte. Geen ZZP-administratie meer.",
  },
  {
    label: "Premium",
    title: "Topadressen in Amsterdam",
    body:
      "4- en 5-sterren hotels, fine-dining restaurants, banqueting en exclusieve events — geen middelmaat.",
  },
  {
    label: "Eerlijk",
    title: "Transparante uurlonen",
    body:
      "Marktconforme tarieven, eerlijke reiskostenvergoeding, geen verborgen inhoudingen.",
  },
  {
    label: "Matching",
    title: "Persoonlijke begeleiding",
    body:
      "Wij kiezen een plek die past bij jouw niveau, stijl en wensen — geen anoniem rooster.",
  },
  {
    label: "Flexibiliteit",
    title: "Beschikbaarheid in overleg",
    body:
      "Geen verplicht-volle weken. Wij werken met jouw beschikbaarheid, niet ertegen.",
  },
  {
    label: "Vakkennis",
    title: "Maarten kent de scene",
    body:
      "20+ jaar in Amsterdamse topkeukens. Geen call-center, wel iemand die je vak begrijpt.",
  },
];

const roles = [
  "Chef de cuisine",
  "Sous chef",
  "Chef de partie",
  "Commis",
  "Banqueting chef",
  "Breakfast chef",
  "Patissier",
  "Roomservice kok",
  "Keukenhulp",
  "Bediening / Host",
  "Runner",
  "Eventcoördinatie",
];

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

      <PageHero
        eyebrow="Werken bij Chef & Serve"
        title="Premium plekken. Loondienst-zekerheid. Vrijheid in je rooster."
        intro={
          <p>
            Werk in de top van de Amsterdamse hospitality — met een
            werkgever die naast je staat, niet tegen je.
          </p>
        }
        image="/images/chef-portrait.jpg"
        imageAlt="Chef in actie"
      />

      {/* Roles strip */}
      <section className="bg-white py-16 md:py-20">
        <div className="mx-auto max-w-container px-4">
          <div className="mb-10 text-center">
            <SectionLabel>Voor wie zijn wij?</SectionLabel>
            <h2 className="mx-auto mt-3 max-w-3xl font-serif text-3xl text-ink-900 md:text-4xl">
              Vakmensen op elk niveau
            </h2>
          </div>
          <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-2 md:gap-3">
            {roles.map((r) => (
              <span
                key={r}
                className="inline-block rounded-full border border-gray-200 bg-bg-gray px-4 py-2 font-ui text-sm text-ink-700"
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Editorial split */}
      <SplitSection
        bg="gray"
        eyebrow="Onze belofte"
        title="Wij behandelen je als professional, niet als nummer"
        body={
          <>
            <p>
              Eerlijke communicatie, snelle reactie op vragen, duidelijke
              roosters en een werkgever die naast je staat — niet tegen je.
            </p>
            <p>
              Geen valse beloftes, geen onverwachte inhoudingen, geen &ldquo;ZZP
              via achterdeur&rdquo;. Wat we afspreken, dat doen we.
            </p>
          </>
        }
        image="/images/team-service.jpg"
        imageAlt="Chef & Serve hospitality team"
      />

      {/* Benefits grid */}
      <section className="bg-white py-20 md:py-28">
        <div className="mx-auto max-w-container px-4">
          <div className="mb-16 text-center">
            <SectionLabel>Wat bieden wij?</SectionLabel>
            <h2 className="mx-auto mt-3 max-w-3xl font-serif text-3xl text-ink-900 md:text-5xl">
              Zes dingen die je bij ons krijgt
            </h2>
          </div>

          <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-3 lg:gap-16">
            {benefits.map((b) => (
              <div key={b.title}>
                <SectionLabel>{b.label}</SectionLabel>
                <h3 className="mt-3 font-serif text-xl text-ink-900 md:text-2xl">
                  {b.title}
                </h3>
                <p className="mt-3 leading-relaxed text-ink-700">{b.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Apply process */}
      <section className="bg-bg-gray py-20 md:py-28">
        <div className="mx-auto max-w-container px-4">
          <div className="mb-12">
            <SectionLabel>Solliciteren</SectionLabel>
            <h2 className="mt-3 max-w-3xl font-serif text-3xl text-ink-900 md:text-5xl">
              Hoe het aanmelden werkt
            </h2>
          </div>

          <ol className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
            {[
              { n: "01", t: "Stuur je cv", b: <>Mail naar <a href={`mailto:${site.email}`} className="text-burgundy underline-offset-4 hover:underline">{site.email}</a> met korte motivatie.</> },
              { n: "02", t: "Kennismaking", b: "Telefonisch of op kantoor — kort gesprek over je vak en wensen." },
              { n: "03", t: "Contract op maat", b: "Bij een match: loondienst-contract binnen een week." },
              { n: "04", t: "Eerste plaatsing", b: "Eerste shift binnen 1-2 weken — met begeleiding van Maarten en het team." },
            ].map((s) => (
              <li key={s.n}>
                <div className="font-serif text-5xl text-burgundy md:text-6xl">
                  {s.n}
                </div>
                <h3 className="mt-4 font-serif text-xl text-ink-900">{s.t}</h3>
                <p className="mt-3 text-sm leading-relaxed text-ink-700">{s.b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <ClosingCTA
        eyebrow="Klaar voor je volgende stap?"
        heading="Stuur je cv en motivatie"
        body={`Mail naar ${site.email} of bel ons direct. Wij reageren binnen een werkdag.`}
      />
    </>
  );
}
