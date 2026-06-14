/**
 * Klant 360 health verdict — the single "is dit een goede klant?" answer for the admin client
 * detail page. Mirrors chef-inzetbaarheid.ts: PURE + deterministic, re-presenting signals that
 * getClientSummary() already computes into one glanceable verdict + strengths/watchpoints.
 *
 * level (relationship health, NOT a block — you never "refuse" a paying klant):
 *   "sterk"    — valuable + healthy: volume, positive margin, loyalty, signs promptly. Green.
 *   "goed"     — fine, nothing notable either way. Neutral.
 *   "aandacht" — something needs operator attention: negative margin, hours left unsigned,
 *                slow sign-off, dormant-with-history, or no feedback. Amber.
 *
 * No I/O, no Date — fully unit-tested in scripts/smoke-client-health.mts.
 */
export type ClientHealthLevel = "sterk" | "goed" | "aandacht";

export interface ClientHealthInput {
  /** clients.status — prospect | active | paused | inactive | archived (tolerates unknown). */
  status: string;
  completedShifts: number;
  upcomingShifts: number;
  marginCents: number;
  spendCents: number;
  repeatChefs: number;
  ratingsGiven: number;
  /** submitted hours still awaiting THIS klant's signature. */
  pendingSignoff: number;
  /** avg submit → client-sign latency in hours, or null if never signed. */
  signoffAvgHours: number | null;
}

export interface ClientHealthVerdict {
  level: ClientHealthLevel;
  /** "Sterke klant" | "Goede klant" | "Vraagt aandacht" */
  headline: string;
  summary: string;
  /** Positive signals — green chips. */
  strengths: string[];
  /** Attention signals — amber chips. */
  watchpoints: string[];
  /** Suggested operator next-steps derived from the watchpoints — "volgende stap" chips. */
  nextActions: string[];
}

const SLOW_SIGNOFF_HOURS = 72; // >3 days submit→sign = friction worth flagging

export function computeClientHealth(input: ClientHealthInput): ClientHealthVerdict {
  const strengths: string[] = [];
  const watchpoints: string[] = [];
  const nextActions: string[] = [];

  // ---- strengths ----------------------------------------------------------
  if (input.completedShifts >= 10) strengths.push(`Trouwe klant — ${input.completedShifts} diensten afgerond`);
  else if (input.completedShifts >= 3) strengths.push(`${input.completedShifts} diensten afgerond`);

  const marginRatio = input.spendCents > 0 ? input.marginCents / input.spendCents : 0;
  if (input.marginCents > 0 && marginRatio >= 0.2) strengths.push("Gezonde marge");

  if (input.repeatChefs > 0) strengths.push(`${input.repeatChefs} vaste chef${input.repeatChefs > 1 ? "s" : ""}`);
  if (input.upcomingShifts > 0) strengths.push(`${input.upcomingShifts} dienst(en) gepland`);
  if (input.signoffAvgHours != null && input.signoffAvgHours <= 24 && input.completedShifts > 0)
    strengths.push("Tekent uren snel");

  // ---- watchpoints --------------------------------------------------------
  let serious = false;
  if (input.spendCents > 0 && input.marginCents < 0) {
    watchpoints.push("Marge negatief — tarieven nakijken");
    nextActions.push("Tarieven aanpassen");
    serious = true;
  } else if (input.spendCents > 0 && marginRatio < 0.1) {
    watchpoints.push("Dunne marge");
    nextActions.push("Tarieven nakijken");
  }

  if (input.pendingSignoff > 0) {
    watchpoints.push(`${input.pendingSignoff} uurbriefje(s) wachten op handtekening`);
    nextActions.push("Klant aan tekenen herinneren");
    if (input.pendingSignoff >= 3) serious = true;
  }
  if (input.signoffAvgHours != null && input.signoffAvgHours > SLOW_SIGNOFF_HOURS) {
    watchpoints.push("Tekent uren traag (>3 dagen)");
  }
  // dormant: has history but nothing planned.
  if (input.completedShifts >= 3 && input.upcomingShifts === 0) {
    watchpoints.push("Geen nieuwe diensten gepland — even contact opnemen?");
    nextActions.push("Contact opnemen");
  }
  if (input.completedShifts >= 3 && input.ratingsGiven === 0) {
    watchpoints.push("Geeft geen feedback op chefs");
    nextActions.push("Om feedback vragen");
  }
  if (input.status === "paused") watchpoints.push("Status: gepauzeerd");
  if (input.status === "inactive" || input.status === "archived") {
    watchpoints.push(`Status: ${input.status === "archived" ? "gearchiveerd" : "inactief"}`);
    serious = true;
  }

  // ---- level --------------------------------------------------------------
  const level: ClientHealthLevel = serious
    ? "aandacht"
    : strengths.length >= 2 && watchpoints.length === 0
      ? "sterk"
      : watchpoints.length > strengths.length
        ? "aandacht"
        : "goed";

  const headline = level === "sterk" ? "Sterke klant" : level === "aandacht" ? "Vraagt aandacht" : "Goede klant";
  const summary =
    level === "sterk"
      ? "Waardevolle, gezonde klantrelatie — koesteren."
      : level === "aandacht"
        ? "Er is iets dat aandacht vraagt — zie hieronder."
        : "Prima klant, niets bijzonders op te merken.";

  return { level, headline, summary, strengths, watchpoints, nextActions };
}
