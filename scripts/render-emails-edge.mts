/**
 * Email hardening — render every BRANCH variant + edge case that the copywriter
 * preview (one rich sample per template) does NOT cover: the other recipientRole/
 * recipientKind/intent branches, null optionals, and empty arrays. Asserts each
 * produces non-empty HTML, i.e. no template crashes on sparse real data.
 *
 *   npx tsx scripts/render-emails-edge.mts
 */
import * as React from "react";
import { render } from "@react-email/components";

const APP = "https://chefandserve2.vercel.app";
const WHEN = "maandag 15 juni 2026, 18:00–23:00";

const EDGE: Array<{ name: string; label: string; props: Record<string, unknown> }> = [
  // ----- branch variants the main preview never renders -----
  { name: "HoursRejectedByAdminEmail", label: "klant-variant", props: { recipientName: "Eva van Dijk", recipientRole: "klant", chefName: "Sander Bakker", clientName: "Hotel Okura Amsterdam", shiftDate: "2026-06-15", adminNote: "De pauze ontbreekt in de opgave." } },
  { name: "PortalInviteEmail", label: "client", props: { recipientName: "Eva van Dijk", recipientKind: "client", loginUrl: `${APP}/login` } },
  { name: "PortalInviteEmail", label: "internal", props: { recipientName: "Maarten de Groot", recipientKind: "internal", loginUrl: `${APP}/login` } },
  { name: "RecoveryEmail", label: "totp", props: { recipientName: "Maarten de Groot", intent: "totp", recoveryUrl: `${APP}/recover/2fa?token=abc123` } },
  // ----- edge cases: empty arrays + null optionals -----
  { name: "ChefWeekPlanningEmail", label: "lege-week", props: { chefName: "Sander Bakker", weekLabel: "week 26", shifts: [], portalUrl: `${APP}/chef` } },
  { name: "KlantWeekPlanningEmail", label: "lege-week-null-contact", props: { contactName: null, companyName: "Hotel Okura Amsterdam", weekLabel: "week 26", shifts: [], hubUrl: `${APP}/client` } },
  { name: "ShiftConfirmedClientEmail", label: "alle-optionals-null", props: { clientContactName: null, companyName: "Hotel Okura Amsterdam", chefName: "Sander Bakker", chefVakniveau: null, chefYears: null, shiftWhen: WHEN, shiftLocation: null, shiftRole: "Souschef" } },
  { name: "ShiftConfirmedChefEmail", label: "nulls-geen-cta", props: { chefName: "Sander Bakker", clientName: "Hotel Okura Amsterdam", shiftWhen: WHEN, shiftLocation: null, shiftRole: "Souschef", clientContactName: null, clientContactPhone: null } },
  { name: "ShiftProposedEmail", label: "null-rate-notes-city", props: { chefName: "Sander Bakker", clientName: "Hotel Okura Amsterdam", shiftWhen: WHEN, shiftRole: "Souschef", shiftCity: null, shiftRateEur: null, shiftNotes: null, placementUrl: `${APP}/chef/shifts/pl_1` } },
  { name: "ChefProposedKlantEmail", label: "null-contact-niveau", props: { contactName: null, companyName: "Hotel Okura Amsterdam", chefName: "Sander Bakker", chefVakniveau: null, chefYears: null, shiftWhen: WHEN, shiftRole: "Souschef", hubUrl: `${APP}/client/shifts/sh_1` } },
  { name: "ShiftCancelledByChefClientEmail", label: "null-contact-no-hubUrl", props: { clientContactName: null, companyName: "Hotel Okura Amsterdam", chefName: "Sander Bakker", shiftWhen: "maandag 15 juni 2026", reason: "Ik ben ziek geworden.", hoursUntilShift: 50 } },
  { name: "ClientChangeRequestOutcomeKlantEmail", label: "rejected-null-notes", props: { contactName: "Eva van Dijk", companyName: "Hotel Okura Amsterdam", kind: "cancel", outcome: "rejected", shiftWhen: WHEN, shiftRole: "Souschef", decisionNotes: null, shiftUrl: `${APP}/client/shifts/sh_1` } },
  { name: "PrivacyRequestOutcomeEmail", label: "rejected-null", props: { requesterName: null, type: "verwijdering", outcome: "rejected", decisionNotes: null, retainedExplanation: null } },
  { name: "ProfileDataRequestEmail", label: "null-name-one-missing", props: { chefName: null, missingLabels: ["IBAN"], formUrl: `${APP}/intake` } },
];

async function main() {
  let pass = 0;
  const fails: string[] = [];
  for (const e of EDGE) {
    try {
      const mod = (await import(`@/emails/${e.name}`)) as Record<string, React.FC<unknown>>;
      const html = await render(React.createElement(mod[e.name], e.props));
      if (!html || html.length < 200) throw new Error("empty/short render");
      pass++;
      console.log(`  ✓ ${e.name} (${e.label})`);
    } catch (err) {
      fails.push(`${e.name} (${e.label}): ${(err as Error).message}`);
      console.log(`  ✗ ${e.name} (${e.label}) — ${(err as Error).message}`);
    }
  }
  console.log(`\n  ${pass}/${EDGE.length} edge/branch renders ok`);
  if (fails.length) process.exit(1);
}

main();
