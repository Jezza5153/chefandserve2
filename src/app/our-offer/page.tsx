import type { Metadata } from "next";
import Link from "next/link";
import { ClosingCTA } from "@/components/ClosingCTA";
import { JsonLd } from "@/components/JsonLd";
import { PageHero, SectionLabel } from "@/components/PageHero";
import { TrustBanner } from "@/components/TrustBanner";
import {
  breadcrumbNode,
  buildGraph,
  webpageNode,
} from "@/lib/schema";
import { site, navigation } from "@/lib/site";

const SLUG = "our-offer";
const TITLE = "Ons Aanbod — Horeca Personeel in Loondienst, Amsterdam";
const DESCRIPTION =
  "Wat Chef & Serve aanbiedt: chefs, koks, bediening, banqueting en complete event-brigades. 100% loondienst, transparante tarieven, binnen 24 uur inzetbaar.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/${SLUG}/` },
};

const pricing = [
  { role: "Keukenhulp", price: site.pricing.keukenhulp },
  { role: "Bediening", price: site.pricing.bediening },
  { role: "Commis", price: site.pricing.commis },
  { role: "Chef de partie", price: site.pricing.chefDePartie },
  { role: "Sous chef", price: site.pricing.sousChef },
  { role: "Chef de cuisine", price: site.pricing.chefDeCuisine },
] as const;

const steps = [
  { n: "01", t: "Aanvraag", b: "Stuur ons rol, periode, segment en urgentie via mail of telefoon." },
  { n: "02", t: "Persoonlijke match", b: `Wij selecteren handmatig uit ons netwerk van ${site.network.chefs}+ pros.` },
  { n: "03", t: "Bevestiging", b: "Binnen 4-24 uur weet u wie er komt en wanneer." },
  { n: "04", t: "Inzet", b: "Onze professional staat op uw locatie — wij blijven juridisch werkgever." },
  { n: "05", t: "Vangnet", b: "Ziekte of uitval is onze verantwoordelijkheid, niet die van u." },
] as const;

export default function Page() {
  const url = `${site.url}/${SLUG}/`;
  const pageGraph = buildGraph(
    webpageNode({ url, name: TITLE, description: DESCRIPTION }),
    breadcrumbNode([
      { name: "Home", url: `${site.url}/` },
      { name: "Ons aanbod", url },
    ]),
  );

  return (
    <>
      <JsonLd data={pageGraph} />

      <PageHero
        eyebrow="Ons aanbod"
        title="Premium horeca personeel — voor elke rol"
        intro={
          <p>
            Chef &amp; Serve levert het complete horecateam in loondienst — voor
            hotels, restaurants, catering en evenementen in Amsterdam en de
            Randstad. {site.network.chefs}+ gescreende pros, wekelijks groeiend.
          </p>
        }
        image="/images/service-chefs.jpg"
        imageAlt="Chef & Serve horeca personeel"
      />

      {/* Trust banner */}
      <section className="bg-white py-12">
        <div className="mx-auto max-w-container px-4">
          <TrustBanner />
        </div>
      </section>

      {/* Service grid */}
      <section className="bg-white py-20 md:py-28">
        <div className="mx-auto max-w-container px-4">
          <div className="mb-16 text-center">
            <SectionLabel>Diensten</SectionLabel>
            <h2 className="mx-auto mt-3 max-w-3xl font-serif text-3xl text-ink-900 md:text-5xl">
              Volledige horecateams, één partner
            </h2>
          </div>

          <ul className="mx-auto grid max-w-4xl gap-y-6 gap-x-12 text-center md:grid-cols-3">
            {navigation.services.map((s) => (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className="group inline-block font-serif text-lg leading-snug text-ink-900 transition-colors hover:text-burgundy md:text-xl"
                >
                  {s.label}
                  <span className="ml-2 text-burgundy transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Pricing */}
      <section className="bg-bg-gray py-20 md:py-28">
        <div className="mx-auto max-w-container px-4">
          <div className="mb-12 text-center">
            <SectionLabel>Transparante tarieven</SectionLabel>
            <h2 className="mx-auto mt-3 max-w-3xl font-serif text-3xl text-ink-900 md:text-5xl">
              All-in tarieven, geen verborgen kosten
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-ink-700">
              Inclusief loonheffing, sociale lasten, vakantiegeld en
              ziekterisico. Geen ZZP-administratie, geen verrassingen.
            </p>
          </div>

          <div className="mx-auto max-w-3xl overflow-hidden rounded border border-gray-200 bg-white">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-6 py-4 text-left font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
                    Rol
                  </th>
                  <th className="px-6 py-4 text-right font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
                    Vanaf
                  </th>
                </tr>
              </thead>
              <tbody>
                {pricing.map((p, i) => (
                  <tr
                    key={p.role}
                    className={i < pricing.length - 1 ? "border-b border-gray-100" : ""}
                  >
                    <td className="px-6 py-4 font-serif text-lg text-ink-900">{p.role}</td>
                    <td className="px-6 py-4 text-right font-serif text-lg text-burgundy">
                      €{p.price}/uur
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Process */}
      <section className="bg-white py-20 md:py-28">
        <div className="mx-auto max-w-container px-4">
          <div className="mb-12">
            <SectionLabel>Hoe het werkt</SectionLabel>
            <h2 className="mt-3 max-w-3xl font-serif text-3xl text-ink-900 md:text-5xl">
              Van aanvraag tot inzet — in vijf stappen
            </h2>
          </div>

          <ol className="grid gap-10 md:grid-cols-2 lg:grid-cols-5">
            {steps.map((s) => (
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
        heading="Klaar om in te huren?"
        body="Stuur een mail of bel direct. Wij nemen binnen een uur contact op voor een korte briefing en de juiste match."
      />
    </>
  );
}
