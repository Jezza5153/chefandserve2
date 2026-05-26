import type { Metadata } from "next";
import Link from "next/link";
import { ClosingCTA } from "@/components/ClosingCTA";
import { JsonLd } from "@/components/JsonLd";
import { PageHero, SectionLabel } from "@/components/PageHero";
import { SplitSection } from "@/components/SplitSection";
import {
  breadcrumbNode,
  buildGraph,
  personMaartenNode,
  webpageNode,
} from "@/lib/schema";
import { site } from "@/lib/site";

const SLUG = "over-maarten";
const TITLE = "Over Maarten Hogeveen — Founder Chef & Serve";
const DESCRIPTION =
  "Maarten Hogeveen: 20+ jaar in Amsterdamse topkeukens (Lute, Vijff Vlieghen, Swarte Walvis, Mario, Chefstable), oprichter JUSTHORECA, nu Chef & Serve.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/${SLUG}/` },
};

export default function Page() {
  const url = `${site.url}/${SLUG}/`;
  const pageGraph = buildGraph(
    webpageNode({ url, name: TITLE, description: DESCRIPTION }),
    personMaartenNode(),
    breadcrumbNode([
      { name: "Home", url: `${site.url}/` },
      { name: "Wie zijn wij", url: `${site.url}/who-we-are/` },
      { name: "Over Maarten", url },
    ]),
  );

  return (
    <>
      <JsonLd data={pageGraph} />

      <PageHero
        eyebrow="Behind Chef & Serve"
        title="Maarten Hogeveen"
        intro={
          <p>
            Patron Cuisinier, oprichter en eigenaar. 20+ jaar in de Amsterdamse
            hospitality — van casual brasserie tot sterrenkeuken.
          </p>
        }
        image="/images/maarten-portrait.jpg"
        imageAlt="Maarten Hogeveen"
      />

      {/* Carrière split */}
      <SplitSection
        eyebrow="Carrière"
        title="20 jaar in de Amsterdamse top"
        body={
          <>
            <p>
              Maarten begon als jonge kok en bouwde zijn vak op in een rij
              keukens die de stad mede hebben gevormd:
            </p>
            <ul>
              <li>
                <strong>Lute (Restaurant Lute)</strong> — fine-dining onder de
                vlag van Peter Lute
              </li>
              <li>
                <strong>d'Vijff Vlieghen</strong> — Nederlandse keuken op
                wereldniveau aan de Spuistraat
              </li>
              <li>
                <strong>d'Swarte Walvis</strong> — Zaanse hospitality-klassieker
              </li>
              <li>
                <strong>Mario</strong> — Italiaanse keuken, fast-paced
                brasserie
              </li>
              <li>
                <strong>Chefstable</strong> — chef's-table-concept met
                interactieve gastvrijheid
              </li>
            </ul>
            <p>
              Elke keuken heeft Maarten iets geleerd over discipline,
              gastvrijheid en wat een team kan bereiken als de mise-en-place
              klopt.
            </p>
          </>
        }
        image="/images/service-werving.jpg"
        imageAlt="Chef plating dessert"
      />

      {/* JUSTHORECA */}
      <SplitSection
        reverse
        bg="gray"
        eyebrow="JUSTHORECA — 2017-2025"
        title="Wat we hebben opgebouwd, en waarom we stopten"
        body={
          <>
            <p>
              In 2017 richtte Maarten <strong>JUSTHORECA</strong> op — een
              Amsterdams uitzendbureau dat in 8 jaar uitgroeide tot één van de
              bekendere namen in de regio. JUSTHORECA werkte voornamelijk via
              ZZP-constructies, wat tot 2024 de standaard was in de horeca.
            </p>
            <p>
              In 2025 maakte de Nederlandse overheid een einde aan die
              werkwijze. De handhaving van de Wet DBA maakte het inzetten van
              ZZP-koks bij langdurige inhuur juridisch onhoudbaar — en niet
              langer eerlijk voor de chefs die het werk leveren.
            </p>
            <p>
              Maarten besloot JUSTHORECA stop te zetten en opnieuw te beginnen
              met een schoon, juridisch sluitend model.
            </p>
          </>
        }
        image="/images/restaurant-interior.jpg"
        imageAlt="Amsterdam restaurant kitchen"
      />

      {/* Quote */}
      <section className="bg-burgundy py-20 text-center text-white md:py-28">
        <div className="mx-auto max-w-container px-4">
          <p className="font-ui text-[11px] uppercase tracking-[0.3em] text-cream">
            In eigen woorden
          </p>
          <blockquote className="mx-auto mt-6 max-w-3xl font-serif text-2xl leading-snug text-white md:text-4xl">
            &ldquo;Ik heb 20 jaar in deze keukens gestaan. Ik weet wat er van een
            chef gevraagd wordt op zondagochtend bij 80 covers, en ik weet welke
            man of vrouw daar het beste past.&rdquo;
          </blockquote>
          <p className="mt-8 font-ui text-[11px] uppercase tracking-[0.18em] text-cream">
            — Maarten Hogeveen
          </p>
        </div>
      </section>

      {/* Today */}
      <SplitSection
        bg="ink"
        eyebrow="Chef & Serve — 2025 → heden"
        title="100% loondienst, geen achterdeur"
        body={
          <>
            <p>
              Chef &amp; Serve is gebouwd op één uitgangspunt:{" "}
              <strong>100% loondienst, geen ZZP, geen achterdeur</strong>.
            </p>
            <p>
              Wij zijn de juridische werkgever van iedereen die wij plaatsen —
              wij betalen het loon, dragen de loonheffing af, regelen
              vakantiegeld, pensioen en doorbetaling bij ziekte.
            </p>
            <p>
              Voor klanten: geen Wet DBA-risico, geen achteraf-naheffing, geen
              schijnzelfstandigheid. Voor chefs en bediening: zekerheid,
              eerlijke betaling en een werkgever die naast ze staat.
            </p>
            <p>
              <Link
                href="/ik-ben-maarten-chef-and-serve/"
                className="font-ui text-[11px] uppercase tracking-[0.18em] text-cream underline-offset-4 hover:underline"
              >
                Maarten in eigen woorden →
              </Link>
            </p>
          </>
        }
        image="/images/chef-portrait.jpg"
        imageAlt="Chef working"
      />

      {/* Achievements */}
      <section className="bg-white py-20 md:py-28">
        <div className="mx-auto max-w-container px-4">
          <div className="mb-12 text-center">
            <SectionLabel>Achtergrond &amp; bereik</SectionLabel>
            <h2 className="mx-auto mt-3 max-w-3xl font-serif text-3xl text-ink-900 md:text-5xl">
              In cijfers
            </h2>
          </div>

          <div className="grid gap-12 md:grid-cols-4 md:gap-8">
            {[
              { n: "20+", t: "Jaar ervaring", b: "in Amsterdamse top-hospitality" },
              { n: "8", t: "Jaar JUSTHORECA", b: "als oprichter & eigenaar (2017-2025)" },
              { n: `${site.network.chefs}+`, t: "Hospitality-pros", b: "in actief netwerk, wekelijks groeiend" },
              { n: `${site.network.growthPerWeek}`, t: "Nieuwe vakmensen", b: "per week toegevoegd aan ons netwerk" },
            ].map((s) => (
              <div key={s.t} className="text-center">
                <div className="font-serif text-5xl text-burgundy md:text-6xl">
                  {s.n}
                </div>
                <h3 className="mt-3 font-serif text-lg text-ink-900">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-700">{s.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ClosingCTA
        eyebrow="Direct in contact met Maarten?"
        heading="Hij neemt zelf het eerste gesprek"
        body="Met nieuwe klanten. Bel of mail, en u krijgt binnen een uur reactie."
      />
    </>
  );
}
