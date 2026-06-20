/**
 * CHEF-PR11 — Dutch dictionary. This is the CANONICAL source: its shape defines
 * the `Dict` type, so every other locale (en.ts) is compile-checked to provide
 * exactly these keys. Add a key here first, then mirror it in en.ts.
 *
 * Namespaces are grouped by surface. Start small (nav + common + language); grow
 * one surface per follow-up so we never ship a half-translated screen.
 */
export const nl = {
  language: {
    label: "Taal",
    dutch: "Nederlands",
    english: "English",
    switchToEnglish: "Switch to English",
    switchToDutch: "Schakel naar Nederlands",
  },
  common: {
    more: "Meer",
    moreMenu: "Meer menu",
    close: "Sluiten",
    back: "Terug",
    save: "Opslaan",
    cancel: "Annuleren",
    loading: "Laden…",
    shift: "dienst",
    shifts: "diensten",
    estimate: "indicatie",
    noteOptional: "Toelichting (optioneel)",
    amountError: "Er ging iets mis — controleer het bedrag en probeer opnieuw.",
    noChefProfile: "Geen chef-profiel gekoppeld aan dit account.",
    aClient: "een klant",
  },
  status: {
    approved: "Goedgekeurd",
    rejected: "Afgewezen",
    cancelled: "Geannuleerd",
    pending: "In behandeling",
    concept: "Concept",
    paid: "Betaald",
  },
  nav: {
    today: "Vandaag",
    open: "Open",
    available: "Beschikbaar",
    money: "Geld",
    profile: "Profiel",
    myShifts: "Mijn shifts",
    hours: "Uren",
    moneyExplained: "Geld uitgelegd",
    expenses: "Declaraties",
    invoices: "Facturen",
    myDocuments: "Mijn documenten",
    notifications: "Meldingen",
    board: "Prikbord",
    calendarFeed: "Agenda-feed",
    onboarding: "Onboarding",
    privacy: "Privacy",
  },
  earnings: {
    eyebrow: "Verdiensten",
    title: "Verdiensten & patronen",
    intro:
      "Wat je hebt verdiend uit goedgekeurde uren, en je werkpatroon. Vragen over een uitbetaling? Bel of mail het kantoor.",
    totalEarned: "Totaal verdiend",
    totalEarnedSub: "uit alle goedgekeurde uren",
    last30: "Laatste 30 dagen",
    last30Sub: "recent goedgekeurd",
    forecastLabel: "Verwacht · komende {days} dagen",
    forecastEmpty:
      "Nog geen bevestigde shifts ingepland. Zodra je ingeroosterd bent, zie je hier wat je verwacht te verdienen.",
    forecastDisclaimer:
      "Schatting op basis van je bevestigde shifts. Klanten kunnen nog annuleren en pauzes zijn hier nog niet afgetrokken — het echte bedrag kan dus lager uitvallen.",
    whenPaid: "Wanneer word ik betaald?",
    onTheWay: "Onderweg naar jou:",
    paymentsDisclaimer:
      "Indicatie op basis van je ingediende uren en je tarief. Het kantoor en payroll bevestigen het uiteindelijke bedrag en de uitbetaaldatum.",
    andMore: "+ {n} meer",
    vacationTitle: "Vakantiegeld (schatting)",
    vacationBodyA: "Ongeveer {pct}% over {basis} aan goedgekeurde uren. Dit is een ",
    vacationBodyB: " — payroll houdt de officiële opbouw en uitbetaling bij.",
    assumptionsUpdated: "Aannames bijgewerkt: {date}",
    noData:
      "Je hebt nog geen afgeronde diensten. Zodra je gewerkt hebt en de uren zijn goedgekeurd, zie je hier je verdiensten en patroon.",
    perClient: "Verdiend per klant",
    workdays: "Je werkdagen",
    busiestOn: "Je werkt meestal op",
    roles: "Je rollen",
    outstandingPre: "Je openstaande en in-controle bedragen zie je op je ",
    dashboardLink: "dashboard",
  },
  payments: {
    stages: {
      to_submit: {
        label: "Nog in te dienen",
        nextStep: "Dien je uren in zodat de klant kan tekenen.",
      },
      awaiting_client: {
        label: "Wacht op handtekening klant",
        nextStep:
          "De klant moet je uren tekenen. Duurt het lang? Het kantoor stuurt een herinnering.",
      },
      awaiting_office: {
        label: "Wacht op goedkeuring kantoor",
        nextStep: "Chef & Serve controleert en keurt de getekende uren goed.",
      },
      approved: {
        label: "Goedgekeurd — wordt uitbetaald",
        nextStep: "Je uren zijn goedgekeurd en gaan mee in de eerstvolgende payroll-run.",
      },
      paid_out: {
        label: "Doorgezet voor uitbetaling",
        nextStep: "Doorgegeven aan payroll. De uitbetaaldatum hangt af van de loonrun.",
      },
      rejected: {
        label: "Teruggezet — actie nodig",
        nextStep: "Er klopte iets niet. Pas je uren aan of neem contact op met het kantoor.",
      },
    },
  },
  expenses: {
    eyebrow: "Declaraties",
    title: "Vakantiegeld & kosten",
    intro:
      "Vraag je vakantiegeld uit of declareer gemaakte kosten. Dit zijn verzoeken — het kantoor beoordeelt ze en payroll bevestigt de uiteindelijke bedragen.",
    okVacation: "✓ Je vakantieverzoek is ingediend — het kantoor beoordeelt het.",
    okExpense: "✓ Je declaratie is ingediend — het kantoor beoordeelt het.",
    vacationPayout: "Vakantiegeld uitbetalen",
    vacationEstimateA: "Geschat opgebouwd: ",
    vacationEstimateB:
      " (indicatie, ~{pct}% over je goedgekeurde uren). Payroll bevestigt het echte saldo.",
    amountField: "Bedrag (€)",
    submitRequest: "Verzoek indienen",
    declareCosts: "Kosten declareren",
    declareIntro:
      "Reiskosten, parkeren, OV of kilometers gemaakt voor een shift? Declareer ze hier.",
    kindField: "Soort",
    descriptionOptional: "Omschrijving (optioneel)",
    submitClaim: "Declaratie indienen",
    yourRequests: "Je verzoeken",
    vacationItem: "Vakantiegeld",
    receiptLabel: "Bon (foto, optioneel)",
    categories: {
      reiskosten: "Reiskosten",
      parkeren: "Parkeren",
      ov: "OV",
      kilometers: "Kilometers",
      overig: "Overig",
    },
  },
  invoices: {
    eyebrow: "Facturen",
    title: "Jouw facturen",
    intro:
      "Als ZZP'er stuur je Chef & Serve een factuur voor je goedgekeurde uren. Hieronder zie je wat klaarstaat, dien je factuur in en volg je de status.",
    okSubmitted: "✓ Je factuur is ingediend — het kantoor beoordeelt hem.",
    nonZzpBody:
      "Facturen zijn voor ZZP'ers. Werk je via payroll? Dan regelt Chef & Serve je uitbetaling — je hoeft niets te factureren. Klopt je situatie niet? Pas je voorkeur aan bij Beschikbaarheid of bel het kantoor.",
    readyTitle: "Klaar om te factureren",
    readyBody: " aan goedgekeurde uren ({count} {unit}). Dit is een indicatie — zet het bedrag op je eigen factuur.",
    readyEmpty: "Nog geen goedgekeurde uren die klaarstaan om te factureren.",
    submitTitle: "Factuur indienen",
    amountField: "Bedrag incl. of excl. btw (€)",
    amountPlaceholder: "bijv. 540,00",
    periodFrom: "Periode van",
    periodTo: "tot",
    referenceField: "Je factuurnummer (optioneel)",
    submitInvoice: "Factuur indienen",
    yourInvoices: "Je facturen",
    uploadLabel: "Factuur (PDF, optioneel)",
  },
};

/** The dictionary shape — every locale must satisfy this (string leaves). */
export type Dict = typeof nl;
