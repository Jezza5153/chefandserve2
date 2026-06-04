/**
 * Site-wide constants. Single source of truth for business facts.
 * Update here and the change ripples through schema + footer + contact.
 */

export const site = {
  name: "Chef & Serve",
  legalName: "Chef & Serve",
  alternateName: "Chef and Serve",
  slogan: "100% Payroll. Premium Hospitality Staffing. Geen ZZP-risico.",
  description:
    "Premium horeca uitzendbureau in Amsterdam met een netwerk van 200+ ervaren koks en horecaprofessionals, wekelijks groeiend. 100% loondienst, volledig compliant met Wet DBA 2026 — geen ZZP-risico voor uw hotel, restaurant of evenement. Opgericht door Maarten Hogeveen (oprichter JUSTHORECA 2017-2025), na de ZZP-crackdown herbouwd als payroll-first staffing agency.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://chefandserve.nl",
  locale: "nl-NL",
  language: "nl",
  // Contact
  email: "info@chefandserve.nl",
  phone: "+31625182359",
  phoneDisplay: "+31 6 25 18 23 59",
  phoneAlternate: "+31634369330",
  // Legal
  kvk: "97707538",
  founded: "2025-01-01",
  // Location
  address: {
    street: "Nachtwachtlaan 20",
    postalCode: "1058 EA",
    locality: "Amsterdam",
    region: "Noord-Holland",
    country: "NL",
  },
  geo: {
    lat: 52.3487,
    lng: 4.8494,
  },
  mapUrl:
    "https://www.google.com/maps/place/Nachtwachtlaan+20,+1058+EA+Amsterdam",
  // Service area
  areaServed: ["Amsterdam", "Den Haag", "Rotterdam", "Utrecht"],
  // Opening hours
  openingHours: {
    dayOfWeek: [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ],
    opens: "07:00",
    closes: "23:00",
  },
  // Scale (verified by founder Apr 22, 2026)
  network: {
    chefs: 200,
    growthPerWeek: 50,
    forecastEndOfYear: 800,
  },
  // Pricing (€/hour, all-in)
  pricing: {
    commis: 32,
    chefDePartie: 38,
    sousChef: 45,
    chefDeCuisine: 55,
    bediening: 28,
    keukenhulp: 26,
  },
  // Social
  social: {
    linkedin: "https://www.linkedin.com/company/chef-and-serve/",
    instagram: "https://www.instagram.com/chefandserve.nl/",
    facebook: "https://www.facebook.com/chefandserve/",
    x: "https://x.com/chefandserve",
  },
  // Native in-house intake forms — the public CTAs link here (replaces Jotform).
  intake: {
    chef: "/sollicitatie",
    client: "/horeca-personeel-aanvragen",
  },
  // Legacy Jotform forms — kept only for webhook/inbox reference during the
  // transition; public CTAs now use `intake` above. Remove once webhooks retire.
  jotform: {
    chef: "https://form.jotform.com/252442173847359",
    client: "https://form.jotform.com/252448184762060",
  },
  // Founder
  founder: {
    name: "Maarten Hogeveen",
    title: "Patron Cuisinier — Founder & Owner",
    bio: "20+ jaar ervaring in Amsterdamse topkeukens (Lute, Vijff Vlieghen, Swarte Walvis, Mario, Chefstable). Oprichter van het in 2025 gestopte JUSTHORECA, daarna Chef & Serve als compliant payroll-first opvolger.",
    previousVenture: "JUSTHORECA (2017-2025)",
    careerVenues: [
      "Lute (Restaurant Lute)",
      "d'Vijff Vlieghen",
      "d'Swarte Walvis",
      "Mario",
      "Chefstable",
    ],
  },
} as const;

export const navigation = {
  main: [
    { label: "Ons aanbod", href: "/our-offer/" },
    { label: "Over ons", href: "/who-we-are/" },
    { label: "Werken bij Chef & Serve", href: "/work-with-us/" },
    { label: "Contact", href: "/contact-us/" },
  ],
  services: [
    { label: "Horeca personeel inhuren", href: "/horeca-personeel-inhuren/" },
    { label: "Chef inhuren", href: "/chef-inhuren/" },
    { label: "Kok inhuren Amsterdam", href: "/kok-inhuren-amsterdam/" },
    { label: "Hotel personeel inhuren", href: "/hotel-personeel-inhuren/" },
    { label: "Bediening inhuren", href: "/bediening-inhuren/" },
    { label: "Catering personeel inhuren", href: "/catering-personeel-inhuren/" },
    { label: "Evenement personeel inhuren", href: "/evenement-personeel-inhuren/" },
    { label: "Tijdelijk horeca personeel", href: "/tijdelijk-horeca-personeel/" },
    { label: "Hospitality recruitment", href: "/hospitality-recruitment/" },
  ],
  pillars: [
    {
      label: "Chef inhuren hotel Amsterdam",
      href: "/chef-inhuren-hotel-amsterdam/",
    },
    { label: "Payroll chef inhuren", href: "/payroll-chef-inhuren/" },
  ],
  footer: {
    legal: [
      { label: "Privacybeleid", href: "/privacybeleid/" },
      { label: "Algemene voorwaarden", href: "/algemene-voorwaarden/" },
    ],
  },
} as const;

export const brand = {
  // Hard-coded fallback values (also in tailwind.config.ts)
  primary: "#801B2B", // Burgundy
  dark: "#29292A", // Near-black
  light: "#F7F8FA", // Section bg
  cream: "#FAB89F", // Warm accent
  warmBg: "#FCFAF6", // Cross-link block bg
} as const;
