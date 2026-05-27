/**
 * Cancellation severity — PR-CHEF-5.
 *
 * The plan's UX rule: "Same-day cancellation forces a phone call. Status
 * flip is not enough." This util maps hours-until-shift to a tier so the
 * UI can render the appropriate copy and tel: CTA.
 *
 * Tier 1 (safe)    → > 48 hours
 * Tier 2 (caution) → 24-48 hours
 * Tier 3 (urgent)  → < 24 hours — must call Maarten in addition to portal
 */

export type CancellationTier = "safe" | "caution" | "urgent";

export function tierForHoursUntilShift(hoursUntil: number): CancellationTier {
  if (hoursUntil < 24) return "urgent";
  if (hoursUntil < 48) return "caution";
  return "safe";
}

export function tierForShift(startsAt: Date | string): CancellationTier {
  const ms = new Date(startsAt).getTime() - Date.now();
  return tierForHoursUntilShift(ms / (1000 * 60 * 60));
}

export const MAARTEN_PHONE = "+31612345678"; // TODO: env var

export function urgentCopy(tier: CancellationTier): {
  warning: string | null;
  showCallCta: boolean;
} {
  switch (tier) {
    case "safe":
      return {
        warning: "Wij geven de klant bericht en zoeken vervanging.",
        showCallCta: false,
      };
    case "caution":
      return {
        warning:
          "Let op: deze shift is binnenkort. Annuleer alleen als het echt niet anders kan. Wij proberen vervanging te vinden, maar dat lukt niet altijd.",
        showCallCta: false,
      };
    case "urgent":
      return {
        warning:
          "Bel Chef & Serve direct na annuleren — annuleren via de portal alleen is niet genoeg.",
        showCallCta: true,
      };
  }
}
