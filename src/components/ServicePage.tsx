import { ClosingCTA } from "@/components/ClosingCTA";
import { FAQAccordion } from "@/components/FAQAccordion";
import { JsonLd } from "@/components/JsonLd";
import { PageHero, SectionLabel } from "@/components/PageHero";
import { TrustBanner } from "@/components/TrustBanner";
import type { FAQ } from "@/lib/faqs";
import {
  breadcrumbNode,
  buildGraph,
  faqPageNode,
  serviceNode,
  webpageNode,
} from "@/lib/schema";
import { site } from "@/lib/site";

export type ServiceOffer = {
  name: string;
  pricePerHour?: number;
};

export type ServicePageData = {
  slug: string;
  title: string; // Full h1
  description: string; // Meta description + intro paragraph (lead)
  intro: React.ReactNode; // Lead paragraph (HTML — can include <strong>)
  breadcrumbLabel: string;
  body: React.ReactNode; // Main page body (h2/h3/p/ul/ol/table)
  faqs?: FAQ[];
  faqHeading?: string;
  offers?: ServiceOffer[];
  cta?: {
    heading: string;
    body: string;
  };
  /** Optional pillar link to inject above the FAQ */
  pillarLink?: React.ReactNode;
  /** Optional hero image override (defaults to service-werving.jpg) */
  heroImage?: string;
  /** Optional eyebrow (defaults to a contextual label derived from breadcrumbLabel) */
  heroEyebrow?: string;
};

export function ServicePage({ data }: { data: ServicePageData }) {
  const url = `${site.url}/${data.slug}/`;
  const heroImage = data.heroImage ?? "/images/service-werving.jpg";
  const heroEyebrow = data.heroEyebrow ?? "Premium hospitality staffing";

  const nodes = [
    webpageNode({ url, name: data.title, description: data.description }),
    breadcrumbNode([
      { name: "Home", url: `${site.url}/` },
      { name: data.breadcrumbLabel, url },
    ]),
    serviceNode({
      url,
      name: data.title,
      description: data.description,
      offers: data.offers,
    }),
  ];
  if (data.faqs && data.faqs.length > 0) {
    nodes.push(faqPageNode({ url, faqs: data.faqs }));
  }
  const pageGraph = buildGraph(...nodes);

  return (
    <>
      <JsonLd data={pageGraph} />

      {/* Cinematic page hero */}
      <PageHero
        eyebrow={heroEyebrow}
        title={data.title}
        intro={<p>{data.description}</p>}
        image={heroImage}
        imageAlt={data.breadcrumbLabel}
        size="compact"
      />

      {/* Body content */}
      <section className="bg-white py-20 md:py-24">
        <div className="mx-auto max-w-container px-4">
          <TrustBanner />

          <div className="mx-auto mt-12 max-w-3xl">
            <div className="prose-cs">{data.intro}</div>
            <div className="prose-cs mt-8">{data.body}</div>
          </div>

          {data.pillarLink && (
            <div className="mx-auto mt-12 max-w-3xl">{data.pillarLink}</div>
          )}
        </div>
      </section>

      {/* FAQ */}
      {data.faqs && data.faqs.length > 0 && (
        <section className="bg-bg-gray py-20 md:py-28">
          <div className="mx-auto max-w-container px-4">
            <div className="mb-12 text-center">
              <SectionLabel>Veelgestelde vragen</SectionLabel>
              <h2 className="mx-auto mt-3 max-w-3xl font-serif text-3xl text-ink-900 md:text-5xl">
                {data.faqHeading ?? "Veelgestelde vragen"}
              </h2>
            </div>
            <div className="mx-auto max-w-3xl">
              <FAQAccordion faqs={data.faqs} heading="" />
            </div>
          </div>
        </section>
      )}

      {/* Closing CTA */}
      <ClosingCTA
        heading={data.cta?.heading ?? "Klaar om in te huren?"}
        body={
          data.cta?.body ??
          "Stuur een mail of bel direct. Wij nemen binnen een uur contact op voor een korte briefing."
        }
      />
    </>
  );
}

/** Helper: standard "Lees ook" pillar link blocks for service pages */
import { PillarLinkBlock, InlineLink } from "@/components/PillarLinkBlock";

export function HotelPillarLink() {
  return (
    <PillarLinkBlock>
      Specifiek voor hotels: lees onze complete gids over{" "}
      <InlineLink href="/chef-inhuren-hotel-amsterdam/">
        chef inhuren voor uw hotel in Amsterdam
      </InlineLink>{" "}
      — met payroll-only model, Wet DBA 2026 compliant, inclusief transparante
      tarieven per rol.
    </PillarLinkBlock>
  );
}

export function PayrollPillarLink() {
  return (
    <PillarLinkBlock variant="burgundy">
      Specifiek voor koks via payroll: onze{" "}
      <InlineLink href="/payroll-chef-inhuren/">payroll chef inhuren gids</InlineLink>{" "}
      behandelt het waarom, hoe en wat-het-kost voor compliant kok-inzet in
      Amsterdam.
    </PillarLinkBlock>
  );
}
