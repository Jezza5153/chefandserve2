/**
 * JSON-LD schema builders. Preserves the 9-piece @graph structure
 * from the old WP site (EmploymentAgency+LocalBusiness dual-class,
 * Person, Service with pricing, FAQPage, etc.).
 *
 * Output as <script type="application/ld+json"> in page <head>.
 */
import { site, navigation } from "./site";

type Schema = Record<string, unknown>;

/* --------------------------------------------------------------------
 * Reusable building blocks
 * ------------------------------------------------------------------ */

export function organizationNode(): Schema {
  return {
    "@type": ["EmploymentAgency", "LocalBusiness"],
    "@id": `${site.url}/#organization`,
    name: site.name,
    alternateName: site.alternateName,
    legalName: site.legalName,
    slogan: site.slogan,
    description: site.description,
    url: site.url,
    logo: {
      "@type": "ImageObject",
      url: `${site.url}/images/logo.png`,
      width: 512,
      height: 512,
      caption: `${site.name} logo`,
    },
    image: [`${site.url}/images/logo.png`],
    sameAs: Object.values(site.social),
    telephone: site.phone,
    email: site.email,
    foundingDate: site.founded,
    founder: { "@id": `${site.url}/#maarten-hogeveen` },
    address: {
      "@type": "PostalAddress",
      streetAddress: site.address.street,
      postalCode: site.address.postalCode,
      addressLocality: site.address.locality,
      addressRegion: site.address.region,
      addressCountry: { "@type": "Country", name: site.address.country },
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: site.geo.lat,
      longitude: site.geo.lng,
    },
    hasMap: site.mapUrl,
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: site.openingHours.dayOfWeek,
        opens: site.openingHours.opens,
        closes: site.openingHours.closes,
      },
    ],
    priceRange: "€€-€€€",
    currenciesAccepted: "EUR",
    paymentAccepted: "Invoice, Bank Transfer",
    employmentType: "Payroll",
    areaServed: [
      ...site.areaServed.map((city) => ({ "@type": "City", name: city })),
      { "@type": "AdministrativeArea", name: "Noord-Holland" },
      { "@type": "AdministrativeArea", name: "Randstad" },
    ],
    knowsLanguage: ["nl", "en"],
    knowsAbout: [
      "Horeca personeel",
      "Chef inhuren",
      "Hospitality staffing",
      "Kok inhuren Amsterdam",
      "Horeca uitzendbureau",
      "Catering personeel",
      "Bediening inhuren",
      "Horeca freelancer",
      "Evenement personeel",
      "Hospitality recruitment",
      "Hotel personeel",
      "Restaurant personeel",
      "Keukenpersoneel",
      "Tijdelijk horeca personeel",
      "Payroll horeca",
      "Loondienst horeca",
      "Wet DBA 2026",
      "Schijnzelfstandigheid horeca",
      "ZZP-compliance horeca",
      "Banqueting chef",
      "Hotel breakfast kok",
      "Sous chef inhuren",
      "Executive chef Amsterdam",
    ],
    numberOfEmployees: {
      "@type": "QuantitativeValue",
      minValue: site.network.chefs,
      unitText: "hospitality professionals in active network",
    },
    contactPoint: {
      "@type": "ContactPoint",
      telephone: site.phone,
      email: site.email,
      contactType: "customer service",
      availableLanguage: ["Dutch", "English"],
      areaServed: "NL",
      hoursAvailable: {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: site.openingHours.dayOfWeek,
        opens: site.openingHours.opens,
        closes: site.openingHours.closes,
      },
    },
    identifier: {
      "@type": "PropertyValue",
      propertyID: "KvK",
      value: site.kvk,
    },
    taxID: site.kvk,
    naics: "561320",
    isicV4: "7820",
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Horeca Personeel Diensten",
      itemListElement: navigation.services.map((s) => ({
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: s.label,
          url: `${site.url}${s.href}`,
          serviceType: "Payroll Staffing",
        },
      })),
    },
  };
}

export function personMaartenNode(): Schema {
  return {
    "@type": "Person",
    "@id": `${site.url}/#maarten-hogeveen`,
    name: site.founder.name,
    jobTitle: site.founder.title,
    description: site.founder.bio,
    worksFor: { "@id": `${site.url}/#organization` },
    sameAs: [site.social.linkedin],
    knowsAbout: [
      "Hospitality staffing",
      "Horeca personeel",
      "Wet DBA 2026 compliance",
      "Payroll horeca",
    ],
    alumniOf: site.founder.careerVenues.map((venue) => ({
      "@type": "Organization",
      name: venue,
    })),
  };
}

export function websiteNode(): Schema {
  return {
    "@type": "WebSite",
    "@id": `${site.url}/#website`,
    url: site.url,
    name: site.name,
    description: site.description,
    publisher: { "@id": `${site.url}/#organization` },
    inLanguage: site.locale,
  };
}

export function webpageNode(opts: {
  url: string;
  name: string;
  description: string;
  dateModified?: string;
}): Schema {
  return {
    "@type": "WebPage",
    "@id": opts.url,
    url: opts.url,
    name: opts.name,
    description: opts.description,
    isPartOf: { "@id": `${site.url}/#website` },
    about: { "@id": `${site.url}/#organization` },
    inLanguage: site.locale,
    ...(opts.dateModified ? { dateModified: opts.dateModified } : {}),
  };
}

export function breadcrumbNode(items: Array<{ name: string; url: string }>): Schema {
  return {
    "@type": "BreadcrumbList",
    "@id": `${items[items.length - 1].url}#breadcrumb`,
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function faqPageNode(opts: { url: string; faqs: Array<{ q: string; a: string }> }): Schema {
  return {
    "@type": "FAQPage",
    "@id": `${opts.url}#faqpage`,
    inLanguage: site.locale,
    mainEntity: opts.faqs.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

export function serviceNode(opts: {
  url: string;
  name: string;
  description: string;
  offers?: Array<{ name: string; pricePerHour?: number }>;
}): Schema {
  return {
    "@type": "Service",
    "@id": `${opts.url}#service`,
    serviceType: "Payroll Hospitality Staffing",
    name: opts.name,
    description: opts.description,
    url: opts.url,
    provider: { "@id": `${site.url}/#organization` },
    areaServed: site.areaServed.map((city) => ({ "@type": "City", name: city })),
    availableChannel: {
      "@type": "ServiceChannel",
      serviceUrl: `${site.url}/contact-us/`,
      servicePhone: site.phone,
    },
    ...(opts.offers && opts.offers.length > 0
      ? {
          offers: opts.offers.map((o) => ({
            "@type": "Offer",
            name: o.name,
            ...(o.pricePerHour
              ? {
                  priceSpecification: {
                    "@type": "UnitPriceSpecification",
                    price: o.pricePerHour,
                    priceCurrency: "EUR",
                    unitText: "HOUR",
                    minPrice: o.pricePerHour,
                  },
                }
              : {}),
          })),
        }
      : {}),
  };
}

export function articleNode(opts: {
  url: string;
  headline: string;
  description: string;
  datePublished: string;
  dateModified: string;
  image?: string;
}): Schema {
  return {
    "@type": "Article",
    "@id": `${opts.url}#article`,
    headline: opts.headline,
    description: opts.description,
    datePublished: opts.datePublished,
    dateModified: opts.dateModified,
    author: { "@id": `${site.url}/#maarten-hogeveen` },
    publisher: { "@id": `${site.url}/#organization` },
    mainEntityOfPage: { "@id": opts.url },
    inLanguage: site.locale,
    ...(opts.image
      ? {
          image: {
            "@type": "ImageObject",
            url: opts.image,
          },
        }
      : {}),
  };
}

/* --------------------------------------------------------------------
 * Page-level graph assemblers
 * ------------------------------------------------------------------ */

export function buildGraph(...nodes: Schema[]): string {
  const graph: Schema = {
    "@context": "https://schema.org",
    "@graph": nodes,
  };
  return JSON.stringify(graph);
}
