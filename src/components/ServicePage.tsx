import { CTAButton } from "@/components/CTAButton";
import { FAQAccordion } from "@/components/FAQAccordion";
import { JsonLd } from "@/components/JsonLd";
import { PillarLinkBlock, InlineLink } from "@/components/PillarLinkBlock";
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
  title: string;          // Full h1
  description: string;    // Meta description + intro paragraph (lead)
  intro: React.ReactNode; // Lead paragraph (HTML — can include <strong>)
  breadcrumbLabel: string;
  body: React.ReactNode;  // Main page body (h2/h3/p/ul/ol/table)
  faqs?: FAQ[];
  faqHeading?: string;
  offers?: ServiceOffer[];
  cta?: {
    heading: string;
    body: string;
  };
  /** Optional pillar link to inject above the FAQ */
  pillarLink?: React.ReactNode;
};

export function ServicePage({ data }: { data: ServicePageData }) {
  const url = `${site.url}/${data.slug}/`;
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

      <article className="mx-auto max-w-container px-4 py-section-y-mobile md:py-section-y-tablet lg:py-section-y">
        <TrustBanner />

        <header className="mb-8">
          <h1 className="mb-6">{data.title}</h1>
          <div className="prose-cs">{data.intro}</div>
        </header>

        <div className="prose-cs">{data.body}</div>

        {data.pillarLink}

        {data.faqs && data.faqs.length > 0 && (
          <FAQAccordion
            faqs={data.faqs}
            heading={data.faqHeading ?? "Veelgestelde vragen"}
          />
        )}

        <section className="mt-12 rounded bg-bg-gray p-8 text-center md:p-12">
          <h2 className="mb-4">{data.cta?.heading ?? "Klaar om in te huren?"}</h2>
          <p className="mx-auto mb-6 max-w-prose text-ink-700">
            {data.cta?.body ??
              "Stuur een mail of bel direct. Wij nemen binnen een uur contact op voor een korte briefing."}
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

/** Helper: standard "Lees ook" pillar link blocks for service pages */
export function HotelPillarLink() {
  return (
    <PillarLinkBlock>
      Specifiek voor hotels: lees onze complete gids over{" "}
      <InlineLink href="/chef-inhuren-hotel-amsterdam/">
        chef inhuren voor uw hotel in Amsterdam
      </InlineLink>{" "}
      — met payroll-only model, Wet DBA 2026 compliant, inclusief transparante tarieven per rol.
    </PillarLinkBlock>
  );
}

export function PayrollPillarLink() {
  return (
    <PillarLinkBlock variant="burgundy">
      Specifiek voor koks via payroll: onze{" "}
      <InlineLink href="/payroll-chef-inhuren/">payroll chef inhuren gids</InlineLink> behandelt
      het waarom, hoe en wat-het-kost voor compliant kok-inzet in Amsterdam.
    </PillarLinkBlock>
  );
}
