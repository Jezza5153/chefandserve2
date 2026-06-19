/**
 * P3 blocker explanation — "Waarom is dit nog niet opgelost?" (matures the P1-stubbed
 * DashboardCard.blocker). PURE: given the per-candidate gate signals the fill-drawer
 * already computes (compliance deployability from P3a, marge from P3c, the matching
 * travel/klant-block warnings), it summarises WHY a shift with candidates is still hard
 * to fill — so the owner sees the reason at the fill moment, not just an empty list.
 *
 * Labels only (counts + category), never PII. Unit-tested in
 * scripts/smoke-fill-blockers.mts.
 */

export type FillCandidateSignal = {
  /** P3a: computeChefInzetbaarheid level === 'blocked'. */
  complianceBlocked: boolean;
  /** P3c: estimateMargin tone === 'negative'. */
  marginNegative: boolean;
  /** prefsAdjust: shift beyond the chef's travelRadiusKm. */
  outOfRadius: boolean;
  /** P3b: chef on the klant's blockedChefIds. */
  klantBlocked: boolean;
};

function nChef(n: number): string {
  return n === 1 ? "1 kandidaat" : `${n} kandidaten`;
}

/**
 * Ordered blocker phrases (most blocking first), one per category that applies.
 * Empty when nothing is blocking (the candidates are fine — the shift is just open).
 */
export function summarizeFillBlockers(candidates: FillCandidateSignal[]): string[] {
  const compliance = candidates.filter((c) => c.complianceBlocked).length;
  const klant = candidates.filter((c) => c.klantBlocked).length;
  const radius = candidates.filter((c) => c.outOfRadius).length;
  const margin = candidates.filter((c) => c.marginNegative).length;

  const out: string[] = [];
  if (compliance > 0) out.push(`${nChef(compliance)} niet inzetbaar (VOG/ID/contract)`);
  if (klant > 0) out.push(`${nChef(klant)} door klant geblokkeerd`);
  if (radius > 0) out.push(`${nChef(radius)} buiten reisafstand`);
  if (margin > 0) out.push(`marge negatief bij ${nChef(margin)}`);
  return out;
}
