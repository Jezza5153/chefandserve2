/**
 * Sample data for email template previews.
 *
 * Kept in a separate file so the gallery page can show the raw JSON
 * inside a <details> at the bottom — easy debugging when something looks off.
 *
 * Keep this data realistic but obviously fake (no real chef/client names).
 */

export type TemplateKey =
  | "magic-link"
  | "shift-proposed"
  | "shift-confirmed-client"
  | "portal-invite";

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.chefandserve.nl";

export const sampleProps = {
  "magic-link": {
    url: `${APP}/api/auth/callback/email?token=preview-token-not-valid`,
    recipientEmail: "voorbeeld@chefandserve.nl",
    host: "Chef & Serve",
  },
  "shift-proposed": {
    chefName: "Sander Bakker",
    clientName: "Restaurant De Voorbeeld",
    shiftWhen: "Vrijdag 14 juni 2026, 17:00–23:00",
    shiftRole: "souschef",
    shiftCity: "Amsterdam",
    shiftRateEur: 32.5,
    shiftNotes:
      "Drukke avond, brigade van 4. Sander past goed bij hun keuken — Italiaans + grill.",
    placementUrl: `${APP}/chef/shifts/preview-placement-id`,
  },
  "shift-confirmed-client": {
    clientContactName: "Eva van der Berg",
    companyName: "Restaurant De Voorbeeld",
    chefName: "Sander Bakker",
    chefVakniveau: "souschef",
    chefYears: 8,
    shiftWhen: "Vrijdag 14 juni 2026, 17:00–23:00",
    shiftLocation: "Voorbeeldstraat 12, Amsterdam",
    shiftRole: "souschef",
  },
  "portal-invite": {
    recipientName: "Sander Bakker",
    recipientKind: "chef" as const,
    loginUrl: `${APP}/login`,
  },
} as const;
