/**
 * Calendar-day helpers in the operator's timezone (Europe/Amsterdam). Chef availability
 * blocks are stored as UTC-midnight of the chef's LOCAL calendar day (see chef/availability
 * parseIsoDate). Matching against a shift's absolute `startsAt` must therefore derive the
 * shift's LOCAL day — using setUTCHours on the raw instant uses the UTC day and silently
 * mismatches for shifts whose local date differs from UTC (anything starting between local
 * midnight and ~01:00–02:00: late dinner services past midnight, very-early breakfast prep).
 *
 * Pure, no app imports → unit-testable without env, reusable across surfaces.
 */
const TZ = "Europe/Amsterdam";

/** "YYYY-MM-DD" of an instant in the Amsterdam calendar (en-CA formats as ISO). */
export function amsterdamDayKey(instant: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

/**
 * UTC-midnight Date of an instant's Amsterdam calendar day — matches how chefAvailability.date
 * is stored, so `eq(chefAvailability.date, amsterdamCalendarDayUTC(shift.startsAt))` lines up.
 */
export function amsterdamCalendarDayUTC(instant: Date | string): Date {
  const [y, mo, d] = amsterdamDayKey(instant).split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}
