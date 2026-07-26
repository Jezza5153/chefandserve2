/**
 * KPI baselines (docs/METRICS.md gaps #1, #2, #6) — the three forward/operational
 * numbers a staffing agency steers on, computed in ONE place so the insights page and
 * the AI report tool can never disagree.
 *
 * Honest at beta scale: with 8 chefs the VALUES are thin — the point is starting the
 * habit and the definitions now, so the numbers are trusted by the time they matter.
 *
 *  - timeToFill: shifts.created_at → placements.confirmed_at (median + p90, days
 *    window). Backfillable — both timestamps have always been stored.
 *  - forwardFill: the canonical filled-slot definition (METRICS.md: confirmed
 *    placements capped per shift) over UPCOMING shifts in the window.
 *  - bookedRevenue: already-committed money — upcoming shifts × headcount ×
 *    client rate × duration. Says "what is coming", where every other money number
 *    says "what happened".
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";

const rowsOf = (r: unknown) =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Record<string, unknown>[];

export type KpiBaselines = {
  timeToFill: { medianHours: number | null; p90Hours: number | null; confirmedCount: number; windowDays: number };
  forwardFill: { slots: number; filled: number; pct: number | null; windowDays: number };
  bookedRevenue: { cents: number; shifts: number; missingRate: number; windowDays: number };
};

export async function getKpiBaselines(opts?: {
  timeToFillWindowDays?: number;
  forwardWindowDays?: number;
  bookedWindowDays?: number;
}): Promise<KpiBaselines> {
  const ttfDays = opts?.timeToFillWindowDays ?? 90;
  const fwdDays = opts?.forwardWindowDays ?? 7;
  const bookDays = opts?.bookedWindowDays ?? 30;

  const [ttfRes, fillRes, bookRes] = await Promise.all([
    // Time-to-fill: request → first confirm, per placement, confirmed in the window.
    db.execute(sql`
      select
        percentile_cont(0.5) within group (order by extract(epoch from p.confirmed_at - s.created_at)) as median_s,
        percentile_cont(0.9) within group (order by extract(epoch from p.confirmed_at - s.created_at)) as p90_s,
        count(*)::int as n
      from placements p
      join shifts s on s.id = p.shift_id
      where p.confirmed_at is not null
        and p.confirmed_at >= now() - make_interval(days => ${ttfDays})
        and p.confirmed_at > s.created_at
    `),
    // Forward fill: canonical capped filled-slot definition over UPCOMING shifts.
    db.execute(sql`
      select
        coalesce(sum(s.headcount), 0)::int as slots,
        coalesce(sum(least(c.cnt, s.headcount)), 0)::int as filled
      from shifts s
      left join lateral (
        select count(*)::int as cnt from placements p
        where p.shift_id = s.id and p.status in ('confirmed', 'completed')
      ) c on true
      where s.status not in ('cancelled', 'completed')
        and s.starts_at >= now()
        and s.starts_at < now() + make_interval(days => ${fwdDays})
    `),
    // Booked revenue: committed client money on upcoming shifts (rate × hours × slots).
    db.execute(sql`
      select
        coalesce(sum(
          case when s.client_rate_cents is not null
            then round(s.client_rate_cents * s.headcount * extract(epoch from s.ends_at - s.starts_at) / 3600.0)
            else 0 end
        ), 0)::bigint as cents,
        count(*)::int as shifts,
        count(*) filter (where s.client_rate_cents is null)::int as missing_rate
      from shifts s
      where s.status not in ('cancelled', 'completed')
        and s.starts_at >= now()
        and s.starts_at < now() + make_interval(days => ${bookDays})
    `),
  ]);

  const ttf = rowsOf(ttfRes)[0] ?? {};
  const fill = rowsOf(fillRes)[0] ?? {};
  const book = rowsOf(bookRes)[0] ?? {};

  const toHours = (secs: unknown): number | null =>
    secs == null ? null : Math.round((Number(secs) / 3600) * 10) / 10;
  const slots = Number(fill.slots ?? 0);
  const filled = Number(fill.filled ?? 0);

  return {
    timeToFill: {
      medianHours: toHours(ttf.median_s),
      p90Hours: toHours(ttf.p90_s),
      confirmedCount: Number(ttf.n ?? 0),
      windowDays: ttfDays,
    },
    forwardFill: {
      slots,
      filled,
      pct: slots > 0 ? Math.round((filled / slots) * 100) : null,
      windowDays: fwdDays,
    },
    bookedRevenue: {
      cents: Number(book.cents ?? 0),
      shifts: Number(book.shifts ?? 0),
      missingRate: Number(book.missing_rate ?? 0),
      windowDays: bookDays,
    },
  };
}
