/**
 * CHEF-PR11 — English dictionary. Typed as `Dict` (defined by nl.ts), so the
 * compiler fails the build if a key is missing or misspelled. Keep keys in the
 * same order as nl.ts for easy diffing.
 */
import type { Dict } from "@/lib/i18n/dictionaries/nl";

export const en: Dict = {
  language: {
    label: "Language",
    dutch: "Nederlands",
    english: "English",
    switchToEnglish: "Switch to English",
    switchToDutch: "Switch to Dutch",
  },
  common: {
    more: "More",
    moreMenu: "More menu",
    close: "Close",
    back: "Back",
    save: "Save",
    cancel: "Cancel",
    loading: "Loading…",
  },
  nav: {
    today: "Today",
    open: "Open",
    available: "Available",
    money: "Money",
    profile: "Profile",
    myShifts: "My shifts",
    hours: "Hours",
    moneyExplained: "Money explained",
    expenses: "Expenses",
    invoices: "Invoices",
    myDocuments: "My documents",
    notifications: "Notifications",
    board: "Board",
    calendarFeed: "Calendar feed",
    onboarding: "Onboarding",
    privacy: "Privacy",
  },
};
