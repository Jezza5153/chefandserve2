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
import { gte, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clientMetricsDaily } from "@/lib/db/schema";

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
