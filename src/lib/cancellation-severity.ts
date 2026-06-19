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

// Configurable via NEXT_PUBLIC_MAARTEN_PHONE (this module is imported by the chef-side
// "use client" CancelShiftSection, so it must be client-readable). Falls back to the
// canonical number when unset.
export const MAARTEN_PHONE = process.env.NEXT_PUBLIC_MAARTEN_PHONE ?? "+31612345678";

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

/**
 * CHEF-PR3 — structured cancel reasons (chef cancels AFTER accepting). One source
 * of truth for the picker UI + the server-action validation. Stable snake_case
 * keys (stored in placements.cancel_reason); "verkeerde_info" feeds the
 * overpromise reports — a wrong brief is not the same as a no-show.
 */
export const CANCEL_REASONS = [
  { key: "ziek", label: "Ziek" },
  { key: "familie", label: "Familie / noodgeval" },
  { key: "vervoer", label: "Vervoersprobleem" },
  { key: "dubbel", label: "Dubbel geboekt" },
  { key: "verkeerde_info", label: "Brief / info klopte niet" },
  { key: "anders", label: "Anders" },
] as const;

const CANCEL_REASON_KEYS = new Set(CANCEL_REASONS.map((r) => r.key));

/** Narrow a raw form value to a valid cancel-reason key (else null). */
export function asCancelReason(raw: string): string | null {
  return CANCEL_REASON_KEYS.has(raw as (typeof CANCEL_REASONS)[number]["key"]) ? raw : null;
}

/** Dutch label for a cancel-reason key (falls back to the key). */
export function cancelReasonLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  return CANCEL_REASONS.find((r) => r.key === key)?.label ?? key;
}
