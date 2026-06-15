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
  /** Stable identity for snooze/dismiss state (DASH-3b): `kind` or `kind:entityId`. */
  signalKey?: string;
  /** Snapshot of the signal at render-time; a dismiss auto-clears when this changes. */
  fingerprint?: string;
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

/** The rank of a kind (lower = more urgent). Re-used by the dashboard-cards contract. */
export function priorityOf(kind: AttentionKind): number {
  return PRIORITY[kind];
}

/* ----- KPI trend (▲/▼ only when meaningful) ------------------------------- */

export type DeltaMode = "arrow" | "plain" | "hidden";
export type DeltaDir = "up" | "down" | "flat";

/**
 * Structural (label-free) result of the shared noise guard. Callers format their
 * own copy (period name, units) off this — see `weekDelta` here and `periodDelta`
 * in metrics-history.ts.
 */
export type NoiseGuardedDelta = {
  /** arrow = a meaningful ▲/▼ · plain = show the baseline only · hidden = nothing. */
  mode: DeltaMode;
  dir: DeltaDir;
  /** signed current − previous. */
  diff: number;
  current: number;
  previous: number;
  baseline: number;
};

/**
 * THE shared trend guard (KPI layer routes every ▲/▼ through this). Only treat a
 * change as a confident arrow when the previous baseline is large enough
 * (≥ `baseline`, default 5) that the delta isn't dominated by small-number noise
 * ("1 → 2 = ▲100%"). Below that but with some history → "plain" (show the baseline,
 * no arrow). No history at all → "hidden". Pure + deterministic.
 */
export function noiseGuardedDelta(current: number, previous: number, baseline = 5): NoiseGuardedDelta {
  const diff = current - previous;
  const dir: DeltaDir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const mode: DeltaMode = previous >= baseline ? "arrow" : previous > 0 ? "plain" : "hidden";
  return { mode, dir, diff, current, previous, baseline };
}

export type DeltaResult = {
  /** arrow = show ▲/▼ vs last week · plain = "vorige week: X" · hidden = nothing. */
  mode: DeltaMode;
  label: string;
  dir: DeltaDir;
};

/**
 * Dutch "vs vorige week" trend label, built on the shared `noiseGuardedDelta`
 * guard. Output is unchanged from before the guard was extracted.
 */
export function weekDelta(current: number, previous: number): DeltaResult {
  const g = noiseGuardedDelta(current, previous);
  if (g.mode === "arrow") {
    const arrow = g.dir === "up" ? "▲" : g.dir === "down" ? "▼" : "■";
    return {
      mode: "arrow",
      label: g.dir === "flat" ? "gelijk aan vorige week" : `${arrow} ${Math.abs(g.diff)} vs vorige week`,
      dir: g.dir,
    };
  }
  if (g.mode === "plain") return { mode: "plain", label: `vorige week: ${previous}`, dir: "flat" };
  return { mode: "hidden", label: "", dir: "flat" };
}
