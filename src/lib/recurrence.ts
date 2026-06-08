/**
 * Recurrence expansion for klant recurring shift requests (PR-KLANT-B4).
 *
 * A klant asks for a repeating shift ("elke zaterdag tot eind augustus"); we
 * expand that into a capped list of occurrence dates, each of which becomes its
 * own client_submission the operator triages. Pure + dependency-free so it's
 * trivially testable (the date math is the part most likely to be off-by-one).
 */
export type RepeatFreq = "weekly" | "biweekly";

/** Hard cap so a single request can never flood the inbox. */
export const MAX_OCCURRENCES = 12;

/**
 * Occurrence dates from `startDate`, stepping weekly/biweekly, INCLUSIVE of
 * `until`, capped at `cap`. Dates are "YYYY-MM-DD". Returns just [startDate] if
 * the inputs are degenerate (no `until`, or `until` < `startDate`).
 */
export function expandOccurrences(
  startDate: string,
  freq: RepeatFreq,
  until: string,
  cap: number = MAX_OCCURRENCES,
): string[] {
  if (!startDate) return [];
  if (!until || until < startDate) return [startDate];
  const stepDays = freq === "biweekly" ? 14 : 7;
  const end = new Date(`${until}T00:00:00Z`);
  const out: string[] = [];
  let d = new Date(`${startDate}T00:00:00Z`);
  while (d <= end && out.length < cap) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + stepDays * 86_400_000);
  }
  return out;
}
