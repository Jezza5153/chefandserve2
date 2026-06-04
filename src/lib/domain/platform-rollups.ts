/**
 * platform-rollups — KPI-5. Owner-wide money + fill rollups. Money comes from the KPI
 * snapshot (FINAL hours only); fill-by-role/segment from the LIVE shifts/placements over
 * realized (already-started) shifts. Deterministic + honest.
 *
 * The capacity "utilization" is explicitly an ESTIMATE: we have no positive availability
 * data (chef_availability stores blocked dates, not capacity), so utilization is computed
 * against a SURFACED assumption (hours/chef/week) and the UI must show that assumption —
 * never present it as a measured fact.
 */
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";

const ASSUMED_HOURS_PER_CHEF_PER_WEEK = 32; // surfaced assumption for the capacity estimate
const FILL_WINDOW_DAYS = 30;

function rows<T>(r: unknown): T[] {
  return Array.isArray(r) ? (r as T[]) : ((r as { rows?: T[] }).rows ?? []);
}

export type MoneyWindow = { revenueCents: number; loonCostCents: number; marginCents: number };
export type FillBreakdown = { key: string; slots: number; filled: number; rate: number | null };
export type PlatformRollups = {
  week: MoneyWindow;
  month: MoneyWindow;
  ytd: MoneyWindow;
  fillWindowDays: number;
  fillByRole: FillBreakdown[];
  fillBySegment: FillBreakdown[];
  overallFill: FillBreakdown;
  activeChefs: number;
  workedHours: number;
  capacity: { assumedHoursPerChefPerWeek: number; utilizationPct: number | null };
};

function fill(slots: number, filled: number, key = ""): FillBreakdown {
  return { key, slots, filled, rate: slots > 0 ? filled / slots : null };
}

export async function getPlatformRollups(): Promise<PlatformRollups> {
  const [moneyRes, roleRes, segRes, supplyRes] = await Promise.all([
    db.execute(sql`
      SELECT
        coalesce(sum(revenue_cents) filter (where snapshot_date >= (now()-interval '7 days')::date),0)::bigint  AS rev_w,
        coalesce(sum(pay_cents)     filter (where snapshot_date >= (now()-interval '7 days')::date),0)::bigint  AS pay_w,
        coalesce(sum(revenue_cents) filter (where snapshot_date >= (now()-interval '30 days')::date),0)::bigint AS rev_m,
        coalesce(sum(pay_cents)     filter (where snapshot_date >= (now()-interval '30 days')::date),0)::bigint AS pay_m,
        coalesce(sum(revenue_cents),0)::bigint AS rev_y,
        coalesce(sum(pay_cents),0)::bigint     AS pay_y
      FROM chef_metrics_daily
      WHERE snapshot_date >= date_trunc('year', now())::date
    `),
    db.execute(sql`
      SELECT role_needed AS key, sum(headcount)::int AS slots, sum(filled)::int AS filled
      FROM (
        SELECT s.role_needed, s.headcount,
          least((SELECT count(*) FROM placements p WHERE p.shift_id = s.id AND p.status IN ('confirmed','completed')), s.headcount)::int AS filled
        FROM shifts s
        WHERE s.starts_at >= now() - interval '30 days' AND s.starts_at <= now()
      ) t GROUP BY role_needed ORDER BY slots DESC
    `),
    db.execute(sql`
      SELECT coalesce(segment::text, 'onbekend') AS key, sum(headcount)::int AS slots, sum(filled)::int AS filled
      FROM (
        SELECT s.segment, s.headcount,
          least((SELECT count(*) FROM placements p WHERE p.shift_id = s.id AND p.status IN ('confirmed','completed')), s.headcount)::int AS filled
        FROM shifts s
        WHERE s.starts_at >= now() - interval '30 days' AND s.starts_at <= now()
      ) t GROUP BY segment ORDER BY slots DESC
    `),
    db.execute(sql`
      SELECT count(distinct chef_id)::int AS chefs, coalesce(sum(hours_worked_minutes),0)::int AS minutes
      FROM chef_metrics_daily
      WHERE snapshot_date >= (now()-interval '30 days')::date AND hours_worked_minutes > 0
    `),
  ]);

  const m = rows<Record<string, string>>(moneyRes)[0] ?? {};
  const mw = (rev: string, pay: string): MoneyWindow => {
    const r = Number(rev ?? 0);
    const p = Number(pay ?? 0);
    return { revenueCents: r, loonCostCents: p, marginCents: r - p };
  };

  const fillByRole = rows<{ key: string; slots: number; filled: number }>(roleRes).map((r) =>
    fill(Number(r.slots), Number(r.filled), r.key),
  );
  const fillBySegment = rows<{ key: string; slots: number; filled: number }>(segRes).map((r) =>
    fill(Number(r.slots), Number(r.filled), r.key),
  );
  const totalSlots = fillByRole.reduce((a, r) => a + r.slots, 0);
  const totalFilled = fillByRole.reduce((a, r) => a + r.filled, 0);

  const supply = rows<{ chefs: number; minutes: number }>(supplyRes)[0] ?? { chefs: 0, minutes: 0 };
  const activeChefs = Number(supply.chefs);
  const workedHours = Math.round(Number(supply.minutes) / 60);
  const assumedCapacity = activeChefs * ASSUMED_HOURS_PER_CHEF_PER_WEEK * (FILL_WINDOW_DAYS / 7);

  return {
    week: mw(m.rev_w, m.pay_w),
    month: mw(m.rev_m, m.pay_m),
    ytd: mw(m.rev_y, m.pay_y),
    fillWindowDays: FILL_WINDOW_DAYS,
    fillByRole,
    fillBySegment,
    overallFill: fill(totalSlots, totalFilled),
    activeChefs,
    workedHours,
    capacity: {
      assumedHoursPerChefPerWeek: ASSUMED_HOURS_PER_CHEF_PER_WEEK,
      utilizationPct: assumedCapacity > 0 ? Math.round((workedHours / assumedCapacity) * 100) : null,
    },
  };
}
