import type { Metadata } from "next";
import Link from "next/link";
import { CTAButton } from "@/components/CTAButton";
import { FAQAccordion } from "@/components/FAQAccordion";
import { JsonLd } from "@/components/JsonLd";
import { TrustBanner } from "@/components/TrustBanner";
import { homepageFaqs } from "@/lib/faqs";
import {
  breadcrumbNode,
  buildGraph,
  faqPageNode,
  webpageNode,
} from "@/lib/schema";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `${site.name} — Premium Horeca Uitzendbureau Amsterdam`,
  description:
    "100% loondienst horeca uitzendbureau Amsterdam. 200+ koks en chefs in netwerk, geen ZZP-risico, Wet DBA 2026 compliant. Binnen 24 uur inzetbaar.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  const url = `${site.url}/`;
  const pageGraph = buildGraph(
    webpageNode({
      url,
      name: `${site.name} — Premium Horeca Uitzendbureau Amsterdam`,
      description: site.description,
    }),
    breadcrumbNode([{ name: site.name, url }]),
    faqPageNode({ url, faqs: homepageFaqs }),
  );

  return (
    <>
      <JsonLd data={pageGraph} />

      {/* Hero — dark background, serif heading, dual CTA */}
      <section className="bg-ink-900 text-white">
        <div className="mx-auto grid max-w-container gap-12 px-4 py-section-y-mobile md:py-section-y-tablet lg:grid-cols-2 lg:py-section-y">
          <div className="flex flex-col justify-center">
            <p className="mb-3 font-ui text-sm uppercase tracking-widest text-cream">
              Serving the people, making the moment.
            </p>
            <h1 className="mb-6 text-white">
              Premium Horeca Uitzendbureau Amsterdam
            </h1>
            <p className="mb-8 max-w-prose text-base leading-relaxed text-gray-300 md:text-lg">
              200+ gescreende koks en chefs in actief netwerk. 100% loondienst,
              geen ZZP-risico, Wet DBA 2026 compliant. Binnen 24 uur inzetbaar
              in Amsterdam en de Randstad.
            </p>
            <div className="flex flex-wrap gap-3">
              <CTAButton href="/contact-us/" variant="primary">
                Plan een gesprek
              </CTAButton>
              <CTAButton href="/our-offer/" variant="outline">
                Bekijk ons aanbod
              </CTAButton>
            </div>
          </div>

          {/* Hero visual placeholder — user uploads */}
          <div className="aspect-[4/5] overflow-hidden rounded bg-ink-700">
            <div className="flex h-full items-center justify-center text-gray-500">
              [hero image: public/images/hero.jpg]
            </div>
          </div>
        </div>
      </section>

      {/* Two doorways: looking for work? / looking for a chef? */}
      <section className="bg-burgundy text-white">
        <div className="mx-auto grid max-w-container gap-px bg-burgundy md:grid-cols-2">
          <Link
            href="/work-with-us/"
            className="group flex flex-col justify-between p-8 transition-colors hover:bg-burgundy-900 md:p-12"
          >
            <h2 className="font-serif text-white">Op zoek naar werk?</h2>
            <p className="mt-6 text-sm leading-relaxed text-burgundy-100">
              Werk in Amsterdamse tophotels en topkeukens. Loondienst-zekerheid,
              flexibele inzet, persoonlijke matching.
            </p>
            <span className="mt-6 text-sm font-medium uppercase tracking-wide underline-offset-4 group-hover:underline">
              Werken bij Chef &amp; Serve →
            </span>
          </Link>

          <Link
            href="/contact-us/"
            className="group flex flex-col justify-between p-8 transition-colors hover:bg-burgundy-900 md:p-12"
          >
            <h2 className="font-serif text-white">Zoekt u een chef?</h2>
            <p className="mt-6 text-sm leading-relaxed text-burgundy-100">
              Binnen 24 uur een chef, kok of bediening op uw locatie. 200+ pros
              in netwerk, 100% payroll-veilig.
            </p>
            <span className="mt-6 text-sm font-medium uppercase tracking-wide underline-offset-4 group-hover:underline">
              Vraag personeel aan →
            </span>
          </Link>
        </div>
      </section>

      {/* What we offer */}
      <section className="mx-auto max-w-container px-4 py-section-y-mobile md:py-section-y-tablet lg:py-section-y">
        <div className="mb-12 max-w-prose">
          <p className="mb-3 font-ui text-sm uppercase tracking-widest text-burgundy">
            Gemaakt voor hotels en restaurants die nooit concessies doen aan
            kwaliteit
          </p>
          <h2 className="mb-6">Wat wij bieden</h2>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: "Chef inhuren",
              desc: "Commis tot executive chef. Persoonlijk gematcht aan uw keuken.",
              href: "/chef-inhuren/",
            },
            {
              title: "Kok inhuren Amsterdam",
              desc: "Professionele koks in loondienst, geen ZZP-risico.",
              href: "/kok-inhuren-amsterdam/",
            },
            {
              title: "Hotel personeel",
              desc: "Banqueting, breakfast, roomservice — voor 4- en 5-sterren hotels.",
              href: "/hotel-personeel-inhuren/",
            },
            {
              title: "Bediening inhuren",
              desc: "Gekwalificeerde hosts en bediening voor restaurants en events.",
              href: "/bediening-inhuren/",
            },
            {
              title: "Catering & events",
              desc: "Complete brigades voor bruiloften, corporate events en festivals.",
              href: "/catering-personeel-inhuren/",
            },
            {
              title: "Hospitality recruitment",
              desc: "Werving en selectie voor vaste posities.",
              href: "/hospitality-recruitment/",
            },
          ].map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="group block rounded border border-gray-200 bg-white p-6 transition-shadow hover:shadow-md"
            >
              <h3 className="mb-2 group-hover:text-burgundy">{s.title}</h3>
              <p className="mb-4 text-sm text-ink-700">{s.desc}</p>
              <span className="text-sm font-medium text-burgundy underline-offset-4 group-hover:underline">
                Meer info →
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Our values */}
      <section className="bg-bg-gray">
        <div className="mx-auto max-w-container px-4 py-section-y-mobile md:py-section-y-tablet lg:py-section-y">
          <div className="mb-12 max-w-prose">
            <p className="mb-3 font-ui text-sm uppercase tracking-widest text-burgundy">
              Het fundament onder onze werkwijze
            </p>
            <h2 className="mb-6">Onze waarden</h2>
            <p className="text-lg leading-relaxed text-ink-700">
              Gebouwd op vertrouwen, gedreven door mensen. Wij zijn klein
              genoeg om elke chef persoonlijk te kennen, groot genoeg om binnen
              24 uur de juiste match te leveren.
            </p>
          </div>
        </div>
      </section>

      {/* Two pillars callout */}
      <section className="mx-auto max-w-container px-4 py-section-y-mobile md:py-section-y-tablet lg:py-section-y">
        <h2 className="mb-8 text-center">Onze diensten — premium horeca personeel</h2>
        <div className="grid gap-6 md:grid-cols-2">
          <Link
            href="/chef-inhuren-hotel-amsterdam/"
            className="group block rounded border border-gray-200 bg-white p-8 transition-shadow hover:shadow-lg"
          >
            <h3 className="mb-3 font-serif text-2xl group-hover:text-burgundy">
              Chef inhuren voor uw hotel in Amsterdam
            </h3>
            <p className="mb-4 text-ink-700">
              Complete gids met chef-rollen, banqueting & breakfast specialisten,
              transparante tarieven (€32-55/uur) en de payroll-route voor
              hotels.
            </p>
            <span className="text-sm font-medium uppercase tracking-wide text-burgundy">
              Lees de complete gids →
            </span>
          </Link>

          <Link
            href="/payroll-chef-inhuren/"
            className="group block rounded border border-gray-200 bg-white p-8 transition-shadow hover:shadow-lg"
          >
            <h3 className="mb-3 font-serif text-2xl group-hover:text-burgundy">
              Payroll chef inhuren — zonder ZZP-risico
            </h3>
            <p className="mb-4 text-ink-700">
              Waarom payroll het standaard-model is in 2026. De JUSTHORECA-les,
              vergelijkingstabel en de Wet DBA-compliance route.
            </p>
            <span className="text-sm font-medium uppercase tracking-wide text-burgundy">
              Lees de payroll-gids →
            </span>
          </Link>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-container px-4 py-section-y-mobile md:py-section-y-tablet lg:py-section-y">
        <TrustBanner />
        <FAQAccordion faqs={homepageFaqs} heading="Veelgestelde vragen" />
      </section>
    </>
  );
}
