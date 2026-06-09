/**
 * timeContextBlock — tells the model what "now" is (Europe/Amsterdam), as part of the DYNAMIC
 * trailing context message (NOT the cached system-prompt prefix — it changes every minute and
 * would defeat prompt caching there).
 *
 * Without this the model literally does not know today's date: tools compute dates server-side
 * correctly, but the model's own reasoning about "vandaag/morgen/volgende week/week 28" floats
 * on its training prior. One sentence fixes a whole class of off-by-a-day answers.
 */

/** Y/M/D of `now` as seen in Amsterdam (DST-correct), regardless of server timezone. */
function amsterdamYmd(now: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** ISO-8601 week number of the AMSTERDAM calendar date (not the UTC date — matters around midnight). */
export function amsterdamIsoWeek(now: Date): number {
  const { y, m, d } = amsterdamYmd(now);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7; // Mon=1 … Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - day); // shift to the Thursday of this ISO week
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Dutch one-liner for the trailing context message: "Het is nu woensdag 10 juni 2026, 14:32 …". */
export function timeContextBlock(now: Date = new Date()): string {
  const datum = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  const tijd = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return `\n\nHet is nu ${datum}, ${tijd} uur (Europe/Amsterdam, week ${amsterdamIsoWeek(now)}). Reken "vandaag", "morgen", "deze week" en weeknummers altijd vanaf dit moment.`;
}
