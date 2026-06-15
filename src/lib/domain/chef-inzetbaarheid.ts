/**
 * Chef inzetbaarheid (deployability) verdict — the single "kan deze chef de vloer
 * op?" answer for the chef detail page.
 *
 * PURE + deterministic. It re-presents readiness signals that are ALREADY computed
 * elsewhere — `getOnboardingReadiness` (payroll/identity), `getProfileCompleteness`
 * (matchable profile) and the reliability/churn read-model — into one glanceable
 * verdict plus an explicit blocker/warning list, so an operator doesn't have to
 * assemble it in their head from six scattered sections.
 *
 * level:
 *   "blocked" — a HARD reason makes deploying irresponsible: can't legally deploy /
 *               can't pay (missing BSN/IBAN/ID), ID expired, or the chef is
 *               inactive/archived. Red. `blockers[]` is non-empty.
 *   "almost"  — deployable, but something needs attention first: still in onboarding,
 *               ID expiring soon, thin profile, or a reliability flag. Amber.
 *   "ready"   — green light, nothing outstanding.
 *
 * No I/O and no `Date` side effects — `idExpired`/`idExpiringSoon` are pre-computed
 * by the caller (getOnboardingReadiness), keeping this fully unit-testable. Tested in
 * scripts/smoke-chef-inzetbaarheid.mts.
 */

export type InzetLevel = "ready" | "almost" | "blocked";

export type ChurnLevel = "none" | "low" | "watch" | "elevated";

export interface InzetbaarheidInput {
  /** chef.status — onboarding | active | paused | inactive | archived (tolerates unknown). */
  status: string;
  /** getOnboardingReadiness().missingCritical — payroll/identity essentials still missing. */
  onboardingMissingCritical: string[];
  /** getOnboardingReadiness().idExpired */
  idExpired: boolean;
  /** getOnboardingReadiness().idExpiringSoon (within 60d) */
  idExpiringSoon: boolean;
  /** getProfileCompleteness().score — 0–100 matchable-profile completeness. */
  profileScore: number;
  /** workSummary.noShowCount — historical no-shows. */
  noShowCount: number;
  /** buildChefTrends().churn.level — activity-decline signal. */
  churnLevel: ChurnLevel;
}

export interface InzetbaarheidVerdict {
  level: InzetLevel;
  /** "Inzetbaar" | "Bijna inzetbaar" | "Niet inzetbaar" */
  headline: string;
  /** One-line plain-Dutch explanation of the verdict. */
  summary: string;
  /** HARD reasons — must be resolved before deploying. Rendered as red chips. */
  blockers: string[];
  /** SOFT reasons — attention, not blocking. Rendered as amber chips. */
  warnings: string[];
}

const STATUS_LABEL: Record<string, string> = {
  onboarding: "onboarding",
  active: "actief",
  paused: "gepauzeerd",
  inactive: "inactief",
  archived: "gearchiveerd",
};

/** The HARD-blocker subset of the verdict — the deployability gate (P3a). */
export type DeployabilityGate = {
  /** true when there are no hard blockers (status/ID/payroll-identity). */
  deployable: boolean;
  /** Dutch blocker labels (PII-free — field names, never values). */
  blockers: string[];
};

/**
 * PURE: the HARD blockers that make deploying a chef irresponsible — the exact subset
 * of computeChefInzetbaarheid that drives level==='blocked'. The single source of truth
 * for both the chef-detail verdict card AND the propose-time hard-gate
 * (assertChefDeployable), so the two can never drift. Only status/ID/payroll-identity
 * block; soft "almost" signals (profileScore, no-shows, churn, idExpiringSoon) never do.
 */
export function evaluateChefBlockers(input: {
  status: string;
  onboardingMissingCritical: string[];
  idExpired: boolean;
}): DeployabilityGate {
  const blockers: string[] = [];
  if (input.status === "archived") {
    blockers.push("Gearchiveerd");
  } else if (input.status === "inactive") {
    blockers.push("Status: inactief");
  }
  if (input.idExpired) {
    blockers.push("ID-bewijs verlopen");
  }
  // Payroll/identity essentials — can't pay or legally deploy without these.
  for (const missing of input.onboardingMissingCritical) {
    blockers.push(`Ontbreekt: ${missing}`);
  }
  return { deployable: blockers.length === 0, blockers };
}

export function computeChefInzetbaarheid(
  input: InzetbaarheidInput,
): InzetbaarheidVerdict {
  // ---- HARD blockers: deploying would be irresponsible (shared with the gate) ----
  const blockers = [...evaluateChefBlockers(input).blockers];
  const warnings: string[] = [];

  // ---- SOFT warnings: deployable, but flag it ----------------------------
  if (input.status === "paused") {
    warnings.push("Chef is gepauzeerd");
  }
  // Don't nag about onboarding-status when there are already hard blockers.
  if (input.status === "onboarding" && blockers.length === 0) {
    warnings.push("Nog in onboarding — zet op 'Actief' als alles klopt");
  }
  if (input.idExpiringSoon && !input.idExpired) {
    warnings.push("ID-bewijs verloopt binnenkort");
  }
  if (input.profileScore < 80) {
    warnings.push(`Profiel ${input.profileScore}% compleet`);
  }
  if (input.noShowCount > 0) {
    warnings.push(
      `${input.noShowCount} no-show${input.noShowCount > 1 ? "s" : ""} in historie`,
    );
  }
  if (input.churnLevel === "elevated") {
    warnings.push("Verhoogd afhaakrisico");
  } else if (input.churnLevel === "watch") {
    warnings.push("Activiteit loopt terug");
  }

  const level: InzetLevel =
    blockers.length > 0 ? "blocked" : warnings.length > 0 ? "almost" : "ready";

  const headline =
    level === "blocked"
      ? "Niet inzetbaar"
      : level === "almost"
        ? "Bijna inzetbaar"
        : "Inzetbaar";

  const summary =
    level === "blocked"
      ? "Eerst dit oplossen voordat deze chef de vloer op kan."
      : level === "almost"
        ? "Kan ingezet worden — let nog even op het onderstaande."
        : "Volledig klaar voor de vloer.";

  return { level, headline, summary, blockers, warnings };
}

/** Human label for a chef status (shared with the card). */
export function chefStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}
