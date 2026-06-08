/**
 * Owner reporting — PR-REPORT-C.
 *
 * The point-in-time KPIs already exist (platform-rollups, leaderboards,
 * planner-report, insights page). What was missing is the TIME dimension: how
 * revenue / margin / fill move week-over-week. This composes that from the
 * existing `client_metrics_daily` snapshot (written nightly by
 * workers/metrics-snapshot.ts) — no new table or worker needed.
 *
 * Aggregates every client's daily row into ONE platform series, bucketed weekly
 * (≈13 weeks) or monthly (12 months). Empty buckets are filled with zeros so the
 * x-axis is continuous (a quiet week reads as a dip, not a gap).
 */
import { desc, eq, gte, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefMetricsDaily, chefs, clientMetricsDaily, clients } from "@/lib/db/schema";

export type TimeBucket = "week" | "month";

export type PlatformSeriesPoint = {
  /** Bucket-start ISO date, e.g. "2026-06-01". */
  key: string;
  /** Short Dutch label, e.g. "wk 23" or "jun". */
  label: string;
  revenueCents: number;
  marginCents: number;
  slots: number;
  filled: number;
  /** filled / slots, or null when the bucket had no demand. */
  fillRate: number | null;
};

export type PlatformTimeSeries = {
  bucket: TimeBucket;
  points: PlatformSeriesPoint[];
  totals: {
    revenueCents: number;
    marginCents: number;
    slots: number;
    filled: number;
    fillRate: number | null;
  };
};

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mondayOf(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}

function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

/** The continuous list of bucket starts to render (oldest → newest). */
function expectedBuckets(bucket: TimeBucket, now: Date): Date[] {
  const out: Date[] = [];
  if (bucket === "week") {
    let cur = mondayOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7 * 12)));
    const end = mondayOf(now);
    while (cur <= end) {
      out.push(cur);
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate() + 7));
    }
  } else {
    let cur = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    while (cur <= end) {
      out.push(cur);
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    }
  }
  return out;
}

function labelFor(bucket: TimeBucket, d: Date): string {
  if (bucket === "week") return `wk ${isoWeek(d)}`;
  return d.toLocaleDateString("nl-NL", { month: "short" });
}

/**
 * Platform revenue/margin/fill over time, summed across all klanten.
 */
export async function getPlatformTimeSeries(opts: {
  bucket: TimeBucket;
  now?: Date;
}): Promise<PlatformTimeSeries> {
  const now = opts.now ?? new Date();
  const buckets = expectedBuckets(opts.bucket, now);
  const cutoff = buckets[0] ? iso(buckets[0]) : iso(now);
  const truncUnit = opts.bucket === "week" ? "week" : "month";

  const rows = await db
    .select({
      key: sql<string>`to_char(date_trunc(${truncUnit}, ${clientMetricsDaily.snapshotDate}), 'YYYY-MM-DD')`,
      revenue: sql<number>`coalesce(sum(${clientMetricsDaily.spendCents}), 0)`,
      margin: sql<number>`coalesce(sum(${clientMetricsDaily.marginCents}), 0)`,
      filled: sql<number>`coalesce(sum(${clientMetricsDaily.filledSlots}), 0)`,
      slots: sql<number>`coalesce(sum(${clientMetricsDaily.slotsCount}), 0)`,
    })
    .from(clientMetricsDaily)
    .where(gte(clientMetricsDaily.snapshotDate, cutoff))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const byKey = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byKey.set(r.key, r);

  const points: PlatformSeriesPoint[] = buckets.map((d) => {
    const r = byKey.get(iso(d));
    const revenueCents = Number(r?.revenue ?? 0);
    const marginCents = Number(r?.margin ?? 0);
    const filled = Number(r?.filled ?? 0);
    const slots = Number(r?.slots ?? 0);
    return {
      key: iso(d),
      label: labelFor(opts.bucket, d),
      revenueCents,
      marginCents,
      filled,
      slots,
      fillRate: slots > 0 ? filled / slots : null,
    };
  });

  const totals = points.reduce(
    (acc, p) => ({
      revenueCents: acc.revenueCents + p.revenueCents,
      marginCents: acc.marginCents + p.marginCents,
      slots: acc.slots + p.slots,
      filled: acc.filled + p.filled,
    }),
    { revenueCents: 0, marginCents: 0, slots: 0, filled: 0 },
  );

  return {
    bucket: opts.bucket,
    points,
    totals: {
      ...totals,
      fillRate: totals.slots > 0 ? totals.filled / totals.slots : null,
    },
  };
}

function cutoffISO(rangeDays: number, now: Date): string {
  const c = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - rangeDays));
  return c.toISOString().slice(0, 10);
}

export type EntityRevenue = {
  id: string;
  name: string;
  revenueCents: number;
  marginCents: number;
  /** Short supporting metric, e.g. "84% bezet" or "112 u · 14 diensten". */
  detail: string;
};

/** Revenue + margin per klant over the window (top N by revenue). */
export async function getClientRevenueBreakdown(
  rangeDays: number,
  opts?: { now?: Date; limit?: number },
): Promise<EntityRevenue[]> {
  const cutoff = cutoffISO(rangeDays, opts?.now ?? new Date());
  const rows = await db
    .select({
      id: clientMetricsDaily.clientId,
      name: clients.companyName,
      revenue: sql<number>`coalesce(sum(${clientMetricsDaily.spendCents}), 0)`,
      margin: sql<number>`coalesce(sum(${clientMetricsDaily.marginCents}), 0)`,
      slots: sql<number>`coalesce(sum(${clientMetricsDaily.slotsCount}), 0)`,
      filled: sql<number>`coalesce(sum(${clientMetricsDaily.filledSlots}), 0)`,
    })
    .from(clientMetricsDaily)
    .innerJoin(clients, eq(clients.id, clientMetricsDaily.clientId))
    .where(gte(clientMetricsDaily.snapshotDate, cutoff))
    .groupBy(clientMetricsDaily.clientId, clients.companyName)
    .orderBy(desc(sql`coalesce(sum(${clientMetricsDaily.spendCents}), 0)`))
    .limit(opts?.limit ?? 20);
  return rows
    .filter((r) => Number(r.revenue) > 0)
    .map((r) => {
      const slots = Number(r.slots);
      const filled = Number(r.filled);
      const fill = slots > 0 ? Math.round((filled / slots) * 100) : null;
      return {
        id: r.id,
        name: r.name,
        revenueCents: Number(r.revenue),
        marginCents: Number(r.margin),
        detail: fill != null ? `${fill}% bezet` : `${filled} plekken`,
      };
    });
}

/** Revenue + margin per chef over the window (top N by revenue). */
export async function getChefRevenueBreakdown(
  rangeDays: number,
  opts?: { now?: Date; limit?: number },
): Promise<EntityRevenue[]> {
  const cutoff = cutoffISO(rangeDays, opts?.now ?? new Date());
  const rows = await db
    .select({
      id: chefMetricsDaily.chefId,
      name: chefs.fullName,
      revenue: sql<number>`coalesce(sum(${chefMetricsDaily.revenueCents}), 0)`,
      margin: sql<number>`coalesce(sum(${chefMetricsDaily.marginCents}), 0)`,
      minutes: sql<number>`coalesce(sum(${chefMetricsDaily.hoursWorkedMinutes}), 0)`,
      shifts: sql<number>`coalesce(sum(${chefMetricsDaily.completedShifts}), 0)`,
    })
    .from(chefMetricsDaily)
    .innerJoin(chefs, eq(chefs.id, chefMetricsDaily.chefId))
    .where(gte(chefMetricsDaily.snapshotDate, cutoff))
    .groupBy(chefMetricsDaily.chefId, chefs.fullName)
    .orderBy(desc(sql`coalesce(sum(${chefMetricsDaily.revenueCents}), 0)`))
    .limit(opts?.limit ?? 20);
  return rows
    .filter((r) => Number(r.revenue) > 0)
    .map((r) => {
      const hours = Math.round(Number(r.minutes) / 60);
      const shifts = Number(r.shifts);
      return {
        id: r.id,
        name: r.name,
        revenueCents: Number(r.revenue),
        marginCents: Number(r.margin),
        detail: `${hours} u · ${shifts} ${shifts === 1 ? "dienst" : "diensten"}`,
      };
    });
}

/**
 * Noise-guarded week-over-week swing on a metric — for an anomaly nudge. Compares
 * the last COMPLETE bucket to the one before it; null unless the prior bucket is
 * material (≥ €250) AND the swing is ≥ 30%, so 1→2 never trips a "confident" alert.
 */
export function detectSwing(
  points: PlatformSeriesPoint[],
  metric: "revenueCents" | "marginCents",
): { pct: number; direction: "up" | "down"; prevCents: number; lastCents: number } | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1][metric];
  const prev = points[points.length - 2][metric];
  if (prev < 25_000) return null; // immaterial base — don't cry wolf
  const pct = Math.round(((last - prev) / Math.abs(prev)) * 100);
  if (Math.abs(pct) < 30) return null;
  return { pct: Math.abs(pct), direction: pct >= 0 ? "up" : "down", prevCents: prev, lastCents: last };
}
