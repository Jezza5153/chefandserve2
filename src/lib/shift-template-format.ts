/**
 * Shift-template formatting + preview helpers (PR-KLANT-4).
 *
 * PURE functions — no db, no server-only imports — so both server components
 * and client components (the live preview-before-save) can use them.
 *
 * day_of_week uses Postgres DOW: 0=Sunday … 6=Saturday (matches JS getDay()).
 */

export const DOW_LABELS: Record<number, string> = {
  0: "zondag",
  1: "maandag",
  2: "dinsdag",
  3: "woensdag",
  4: "donderdag",
  5: "vrijdag",
  6: "zaterdag",
};

/** "17:00:00" → "17:00" */
export function shortTime(t: string): string {
  return t.slice(0, 5);
}

/** True when the shift crosses midnight (explicit toggle OR end <= start). */
export function isOvernight(
  startsAtTime: string,
  endsAtTime: string,
  endsNextDay: boolean,
): boolean {
  return endsNextDay || shortTime(endsAtTime) <= shortTime(startsAtTime);
}

/** "17:00 – 01:00 (+1 dag)" or "09:00 – 17:00". */
export function formatTimeRange(
  startsAtTime: string,
  endsAtTime: string,
  endsNextDay: boolean,
): string {
  const overnight = isOvernight(startsAtTime, endsAtTime, endsNextDay);
  return `${shortTime(startsAtTime)} – ${shortTime(endsAtTime)}${overnight ? " (+1 dag)" : ""}`;
}

/** Worked hours across the (possibly overnight) boundary. */
export function durationHours(
  startsAtTime: string,
  endsAtTime: string,
  endsNextDay: boolean,
): number {
  const [sh, sm] = shortTime(startsAtTime).split(":").map(Number);
  const [eh, em] = shortTime(endsAtTime).split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (isOvernight(startsAtTime, endsAtTime, endsNextDay)) mins += 24 * 60;
  return Math.round((mins / 60) * 10) / 10;
}

/** "Elke vrijdag · 17:00 – 01:00 (+1 dag)" */
export function formatPattern(t: {
  dayOfWeek: number;
  startsAtTime: string;
  endsAtTime: string;
  endsNextDay: boolean;
}): string {
  return `Elke ${DOW_LABELS[t.dayOfWeek] ?? "dag"} · ${formatTimeRange(t.startsAtTime, t.endsAtTime, t.endsNextDay)}`;
}

/**
 * The calendar dates a template will generate over its horizon, minus
 * exceptions. Display-only — the worker is authoritative (it uses Postgres
 * DOW + AT TIME ZONE). Uses noon to dodge DST midnight edges.
 */
export function previewDates(
  dayOfWeek: number,
  horizonDays: number,
  exceptionIsoDates: ReadonlySet<string> = new Set(),
  from: Date = new Date(),
): string[] {
  const out: string[] = [];
  const base = new Date(from);
  base.setHours(12, 0, 0, 0);
  for (let i = 0; i <= horizonDays; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    if (d.getDay() !== dayOfWeek) continue;
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (exceptionIsoDates.has(iso)) continue;
    out.push(iso);
  }
  return out;
}

/** "vrijdag 7 juni" from an ISO date string. */
export function formatIsoDate(iso: string): string {
  // Parse as local noon to avoid TZ shifting the day.
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0);
  return date.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
