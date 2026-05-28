/**
 * Dashboard intelligence — Cockpit UX phase. Pure + deterministic (no DB, no
 * React), so the "Aandacht nodig" queue ordering and the KPI trend rule are
 * testable and never bury an urgent staffing issue under a low-value alert.
 */

export type AttentionKind =
  | "critical_shift" // under headcount, starts < 24u
  | "open_shift" // empty/open, starts < 48u
  | "underfilled_shift" // partially filled this week
  | "accepted_unconfirmed" // chef said yes, awaiting admin confirm
  | "proposed_no_response" // proposed, no chef response
  | "hours_to_approve" // client_signed hours waiting
  | "change_request" // chef/client profile-change or profile-update awaiting review
  | "inbox" // new chef/client submissions
  | "missing_data" // chef/client profile gaps
  | "system"; // integration/system warnings

export type AttentionTone = "red" | "amber" | "blue" | "grey";

export type AttentionItem = {
  kind: AttentionKind;
  tone: AttentionTone;
  /** lucide-style icon name handled by the renderer ("alert-triangle" | "info" | …). */
  icon: "alert-triangle" | "info" | "clock" | "inbox" | "user-round";
  title: string;
  detail?: string;
  href: string;
  cta?: string;
};

/** Lower = more urgent (rendered first). */
const PRIORITY: Record<AttentionKind, number> = {
  critical_shift: 1,
  open_shift: 2,
  underfilled_shift: 3,
  accepted_unconfirmed: 4,
  proposed_no_response: 5,
  hours_to_approve: 6,
  change_request: 7,
  inbox: 8,
  missing_data: 9,
  system: 10,
};

/**
 * Deterministic priority sort. `Array.sort` is stable, so items of equal kind
 * keep their insertion order (e.g. critical shifts already sorted by start time).
 */
export function rankAttentionItems(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
}

/* ----- KPI trend (▲/▼ only when meaningful) ------------------------------- */

export type DeltaResult = {
  /** arrow = show ▲/▼ vs last week · plain = "vorige week: X" · hidden = nothing. */
  mode: "arrow" | "plain" | "hidden";
  label: string;
  dir: "up" | "down" | "flat";
};

/**
 * Trend label with the noise guard: only show ▲/▼ when last week's baseline is
 * meaningful (≥ 5). Below that, a percentage/arrow is misleading ("1 → 2 = ▲100%"),
 * so fall back to a plain "vorige week: X", or hide entirely when there's nothing.
 */
export function weekDelta(current: number, previous: number): DeltaResult {
  if (previous >= 5) {
    const diff = current - previous;
    const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
    const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "■";
    return {
      mode: "arrow",
      label: dir === "flat" ? "gelijk aan vorige week" : `${arrow} ${Math.abs(diff)} vs vorige week`,
      dir,
    };
  }
  if (previous > 0) return { mode: "plain", label: `vorige week: ${previous}`, dir: "flat" };
  return { mode: "hidden", label: "", dir: "flat" };
}
