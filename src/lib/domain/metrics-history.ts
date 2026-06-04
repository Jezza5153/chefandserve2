/**
 * metrics-history — KPI read-model over chef_metrics_daily / client_metrics_daily
 * (written nightly by workers/metrics-snapshot.ts). The snapshot rows ARE the time
 * axis: a trend is a date-range scan, a window total is a SUM, an average is
 * Σsum/Σcount. Every helper here is deterministic + honest — it only re-shapes
 * already-stored FINAL-hours / raw-count measures, never recomputes or fabricates.
 *
 * The db getters fetch a date window; the pure re-shapers (windowSum / bucketByWeek /
 * weightedAvg / periodDelta) operate on the fetched rows, so trends are unit-testable
 * without a database. periodDelta routes through the shared `noiseGuardedDelta`
 * (dashboard-intel.ts) so a 1→2 blip never renders as a confident ▲100%.
 */
import { and, asc, eq, gte } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  chefMetricsDaily,
  clientMetricsDaily,
  type ChefMetricsDaily,
  type ClientMetricsDaily,
} from "@/lib/db/schema";
import { noiseGuardedDelta, type NoiseGuardedDelta } from "@/lib/domain/dashboard-intel";

export type { ChefMetricsDaily, ClientMetricsDaily };

/** Any snapshot row — the re-shapers only need the date key. */
type Dated = { snapshotDate: string };

/** YYYY-MM-DD for `n` days before `from` (UTC midnight). snapshot_date is a date string. */
export function daysAgoISO(n: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/* ----- db getters --------------------------------------------------------- */

export async function getChefDailySeries(chefId: string, days = 56): Promise<ChefMetricsDaily[]> {
  return db
    .select()
    .from(chefMetricsDaily)
    .where(and(eq(chefMetricsDaily.chefId, chefId), gte(chefMetricsDaily.snapshotDate, daysAgoISO(days))))
    .orderBy(asc(chefMetricsDaily.snapshotDate));
}

export async function getClientDailySeries(clientId: string, days = 56): Promise<ClientMetricsDaily[]> {
  return db
    .select()
    .from(clientMetricsDaily)
    .where(and(eq(clientMetricsDaily.clientId, clientId), gte(clientMetricsDaily.snapshotDate, daysAgoISO(days))))
    .orderBy(asc(clientMetricsDaily.snapshotDate));
}

/* ----- pure re-shapers (unit-testable, no DB) ----------------------------- */

/** Σ of `value(row)` over the most recent `days` calendar days (inclusive of today). */
export function windowSum<T extends Dated>(
  rows: T[],
  value: (r: T) => number,
  days: number,
  today: Date = new Date(),
): number {
  const from = daysAgoISO(days - 1, today);
  return rows.reduce((acc, r) => (r.snapshotDate >= from ? acc + value(r) : acc), 0);
}

/**
 * `buckets` weekly totals oldest→newest, each a 7-day SUM of `value`, aligned so the
 * last bucket ends today. Drives the inline sparklines (KPI-2/3). Rows outside the
 * window (older than `buckets` weeks, or in the future) are ignored.
 */
export function bucketByWeek<T extends Dated>(
  rows: T[],
  value: (r: T) => number,
  buckets = 8,
  today: Date = new Date(),
): number[] {
  const out = new Array<number>(buckets).fill(0);
  const todayMid = new Date(today);
  todayMid.setUTCHours(0, 0, 0, 0);
  for (const r of rows) {
    const rd = new Date(`${r.snapshotDate}T00:00:00Z`);
    const daysAgo = Math.floor((todayMid.getTime() - rd.getTime()) / 86_400_000);
    if (daysAgo < 0) continue;
    const weekAgo = Math.floor(daysAgo / 7);
    if (weekAgo >= buckets) continue;
    out[buckets - 1 - weekAgo] += value(r);
  }
  return out;
}

/** Σsum/Σcount over the window (or all rows when `days` omitted), or null when no observations. */
export function weightedAvg<T extends Dated>(
  rows: T[],
  sum: (r: T) => number,
  count: (r: T) => number,
  days?: number,
  today: Date = new Date(),
): number | null {
  const inWindow = days == null ? rows : rows.filter((r) => r.snapshotDate >= daysAgoISO(days - 1, today));
  let s = 0;
  let c = 0;
  for (const r of inWindow) {
    s += sum(r);
    c += count(r);
  }
  return c > 0 ? s / c : null;
}

/** A weekly trend result: the shared guard + the raw this/prev period totals. */
export type PeriodDelta = NoiseGuardedDelta & { thisPeriod: number; prevPeriod: number };

/**
 * Canonical weekly trend: this last-7-days total vs the prior 7-days total, run
 * through the shared noise guard. `thisPeriod`/`prevPeriod` are returned raw so
 * callers can build their own label copy.
 */
export function periodDelta<T extends Dated>(
  rows: T[],
  value: (r: T) => number,
  today: Date = new Date(),
): PeriodDelta {
  const thisFrom = daysAgoISO(6, today); // today−6 … today (7 days)
  const prevFrom = daysAgoISO(13, today); // today−13 … today−7 (prior 7 days)
  let thisPeriod = 0;
  let prevPeriod = 0;
  for (const r of rows) {
    if (r.snapshotDate >= thisFrom) thisPeriod += value(r);
    else if (r.snapshotDate >= prevFrom) prevPeriod += value(r);
  }
  return { ...noiseGuardedDelta(thisPeriod, prevPeriod), thisPeriod, prevPeriod };
}
