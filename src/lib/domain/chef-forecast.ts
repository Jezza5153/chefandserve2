/**
 * Chef earnings FORECAST — "verwachte verdiensten komende weken".
 *
 * The chef sees past payouts on /chef/earnings (getChefPatterns); this adds the
 * forward view: upcoming CONFIRMED shifts × the chef's rate, bucketed per ISO
 * week. Read-only, the chef's own data.
 *
 * Honesty rules baked in:
 *   - CONFIRMED only (not 'accepted' — accepted = chef said yes but not locked;
 *     including it would over-promise).
 *   - Rate precedence: placements.chefRateCents → shifts.chefRateCents →
 *     chefs.hourlyRate{Min,Max}Cents. When a rate is pinned on the placement or
 *     shift, min == max (no range). When only the chef's band is known, we show
 *     a RANGE (min..max) rather than a single number we can't promise.
 *   - Duration is gross (endsAt − startsAt); unpaid breaks aren't deducted
 *     (shifts carry no break column — that only exists on shift_hours after the
 *     fact). Surfaced as a caveat, never silently.
 *
 * One grouped query + a TS fold (NOT a correlated subquery in a projection,
 * which drizzle+neon-http renders uncorrelated → always 0).
 */
import { and, eq, gt, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, placements, shifts } from "@/lib/db/schema";

export type ForecastWeek = {
  /** ISO week Monday, "YYYY-MM-DD" (Amsterdam). */
  weekStart: string;
  /** "week van 16 jun" */
  label: string;
  shifts: number;
  minCents: number;
  maxCents: number;
};

export type ChefForecast = {
  daysAhead: number;
  weeks: ForecastWeek[];
  totalMinCents: number;
  totalMaxCents: number;
  totalShifts: number;
  /** true when any week's min !== max → UI shows "€X – €Y". */
  hasRange: boolean;
};

function weekLabel(weekStart: string): string {
  // Anchor at noon so a DST shift never rolls the date back a day.
  const d = new Date(`${weekStart}T12:00:00`);
  return `week van ${new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
  }).format(d)}`;
}

export async function getChefForecastEarnings(
  chefId: string,
  daysAhead = 28,
): Promise<ChefForecast> {
  // Gross worked hours per shift × resolved rate, summed per ISO week.
  const hours = sql`(extract(epoch from (${shifts.endsAt} - ${shifts.startsAt})) / 3600.0)`;
  const minRate = sql`coalesce(${placements.chefRateCents}, ${shifts.chefRateCents}, ${chefs.hourlyRateMinCents}, 0)`;
  const maxRate = sql`coalesce(${placements.chefRateCents}, ${shifts.chefRateCents}, ${chefs.hourlyRateMaxCents}, ${chefs.hourlyRateMinCents}, 0)`;

  const rows = await db
    .select({
      weekStart: sql<string>`to_char(date_trunc('week', (${shifts.startsAt} at time zone 'Europe/Amsterdam')), 'YYYY-MM-DD')`,
      shifts: sql<number>`count(*)::int`,
      minCents: sql<number>`coalesce(round(sum(${hours} * ${minRate})), 0)::bigint`,
      maxCents: sql<number>`coalesce(round(sum(${hours} * ${maxRate})), 0)::bigint`,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .where(
      and(
        eq(placements.chefId, chefId),
        eq(placements.status, "confirmed"),
        gt(shifts.startsAt, sql`now()`),
        lte(shifts.startsAt, sql`now() + (${daysAhead} || ' days')::interval`),
        sql`${shifts.status} not in ('cancelled','completed')`,
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const weeks: ForecastWeek[] = rows.map((r) => ({
    weekStart: r.weekStart,
    label: weekLabel(r.weekStart),
    shifts: Number(r.shifts),
    minCents: Number(r.minCents),
    maxCents: Number(r.maxCents),
  }));

  return {
    daysAhead,
    weeks,
    totalMinCents: weeks.reduce((a, w) => a + w.minCents, 0),
    totalMaxCents: weeks.reduce((a, w) => a + w.maxCents, 0),
    totalShifts: weeks.reduce((a, w) => a + w.shifts, 0),
    hasRange: weeks.some((w) => w.maxCents !== w.minCents),
  };
}
