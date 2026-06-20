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
};

/** The dictionary shape — every locale must satisfy this (string leaves). */
export type Dict = typeof nl;
