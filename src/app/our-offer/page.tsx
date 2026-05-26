import type { Metadata } from "next";
import Link from "next/link";
import { CTAButton } from "@/components/CTAButton";
import { JsonLd } from "@/components/JsonLd";
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

      <article className="mx-auto max-w-container px-4 py-section-y-mobile md:py-section-y-tablet lg:py-section-y">
        <TrustBanner />

        <header className="mb-12">
          <h1 className="mb-6">Ons Aanbod — Premium Horeca Personeel</h1>
          <p className="prose-cs text-lg">
            Chef &amp; Serve levert het complete horecateam in loondienst —
            voor hotels, restaurants, catering en evenementen in Amsterdam en
            de Randstad. Met een netwerk van <strong>{site.network.chefs}+
            gescreende koks en hospitality-professionals</strong>, wekelijks
            groeiend met circa {site.network.growthPerWeek} nieuwe medewerkers.
            100% Wet DBA 2026 compliant.
          </p>
        </header>

        {/* Service grid */}
        <section className="mb-16">
          <h2 className="mb-8">Diensten op een rij</h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {navigation.services.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className="group block rounded border border-gray-200 bg-white p-6 transition-shadow hover:shadow-md"
              >
                <h3 className="mb-2 font-serif text-lg group-hover:text-burgundy">
                  {s.label}
                </h3>
                <span className="text-sm font-medium text-burgundy underline-offset-4 group-hover:underline">
                  Meer info →
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Pricing table */}
        <section className="mb-16">
          <h2 className="mb-6">Transparante tarieven</h2>
          <p className="prose-cs mb-6">
            All-in payroll-tarieven (inclusief loonheffing, sociale lasten,
            vakantiegeld, ziekterisico). Geen verborgen kosten, geen
            ZZP-administratie:
          </p>
          <div className="overflow-hidden rounded border border-gray-200">
            <table className="w-full border-collapse text-left">
              <thead className="bg-bg-gray">
                <tr>
                  <th className="border-b border-gray-200 px-4 py-3 font-medium">Rol</th>
                  <th className="border-b border-gray-200 px-4 py-3 font-medium">Tarief vanaf</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border-b border-gray-200 px-4 py-3">Keukenhulp</td>
                  <td className="border-b border-gray-200 px-4 py-3">€{site.pricing.keukenhulp}/uur</td>
                </tr>
                <tr>
                  <td className="border-b border-gray-200 px-4 py-3">Bediening</td>
                  <td className="border-b border-gray-200 px-4 py-3">€{site.pricing.bediening}/uur</td>
                </tr>
                <tr>
                  <td className="border-b border-gray-200 px-4 py-3">Commis</td>
                  <td className="border-b border-gray-200 px-4 py-3">€{site.pricing.commis}/uur</td>
                </tr>
                <tr>
                  <td className="border-b border-gray-200 px-4 py-3">Chef de partie</td>
                  <td className="border-b border-gray-200 px-4 py-3">€{site.pricing.chefDePartie}/uur</td>
                </tr>
                <tr>
                  <td className="border-b border-gray-200 px-4 py-3">Sous chef</td>
                  <td className="border-b border-gray-200 px-4 py-3">€{site.pricing.sousChef}/uur</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Chef de cuisine</td>
                  <td className="px-4 py-3">€{site.pricing.chefDeCuisine}/uur</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* How it works */}
        <section className="mb-16">
          <h2 className="mb-6">Hoe het werkt</h2>
          <ol className="prose-cs">
            <li><strong>Aanvraag</strong> — stuur ons rol, periode, segment en urgentie via mail of telefoon</li>
            <li><strong>Persoonlijke match</strong> — wij selecteren handmatig uit ons netwerk van {site.network.chefs}+ pros</li>
            <li><strong>Bevestiging</strong> — binnen 4-24 uur weet u wie er komt en wanneer</li>
            <li><strong>Inzet</strong> — onze professional staat op uw locatie, wij blijven juridisch werkgever</li>
            <li><strong>Vangnet</strong> — ziekte of uitval is onze verantwoordelijkheid, niet die van u</li>
          </ol>
        </section>

        {/* CTA */}
        <section className="rounded bg-bg-gray p-8 text-center md:p-12">
          <h2 className="mb-4">Klaar om in te huren?</h2>
          <p className="mx-auto mb-6 max-w-prose text-ink-700">
            Stuur een mail of bel direct. Wij nemen binnen een uur contact op
            voor een korte briefing en de juiste match.
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
        </section>
      </article>
    </>
  );
}
