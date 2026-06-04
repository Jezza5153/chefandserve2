/**
 * leaderboards — KPI-4. Windowed rankings over the KPI snapshot tables
 * (chef_metrics_daily / client_metrics_daily). Each board is ONE date-range scan
 * (supported by the `*_date_idx` indexes) grouped by entity — no per-row recompute.
 *
 * Honesty rules carry through from the snapshot: money is FINAL-hours only, the
 * "highest rated" board is gated at ratingCount ≥ 5 (no 1-review chefs topping the
 * list), and "most reliable" needs a real proposal base (≥ 5) before a rate is shown.
 * Soft-deleted / erased chefs+clients are excluded (deletedAt IS NULL).
 */
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefMetricsDaily, chefs, clientMetricsDaily, clients } from "@/lib/db/schema";
import { formatEuro } from "@/lib/hours-labels";
import { daysAgoISO } from "@/lib/domain/metrics-history";

const RATING_MIN = 5; // gate: a chef/board entry needs ≥ 5 ratings to rank on quality
const PROPOSAL_MIN = 5; // gate: ≥ 5 proposals before an acceptance rate is meaningful

export type LeaderboardEntry = {
  id: string;
  name: string;
  value: number; // the ranked metric (cents / count / pct / rating) — for sorting/bars
  display: string; // preformatted for the UI ("€ 1.234,00" / "12 diensten" / "92%" / "4,8★")
  sub?: string; // supporting context
};

export type Leaderboards = {
  windowDays: number;
  topEarners: LeaderboardEntry[];
  busiest: LeaderboardEntry[];
  mostReliable: LeaderboardEntry[];
  highestRated: LeaderboardEntry[];
  topClients: LeaderboardEntry[];
};

export async function getLeaderboards(windowDays = 90, limit = 5): Promise<Leaderboards> {
  const from = daysAgoISO(windowDays);

  const [earners, busiest, reliable, rated, topClients] = await Promise.all([
    // top earners — Σ pay (FINAL hours)
    db
      .select({
        id: chefMetricsDaily.chefId,
        name: chefs.fullName,
        cents: sql<number>`sum(${chefMetricsDaily.payCents})::int`,
      })
      .from(chefMetricsDaily)
      .innerJoin(chefs, eq(chefs.id, chefMetricsDaily.chefId))
      .where(and(gte(chefMetricsDaily.snapshotDate, from), isNull(chefs.deletedAt)))
      .groupBy(chefMetricsDaily.chefId, chefs.fullName)
      .having(sql`sum(${chefMetricsDaily.payCents}) > 0`)
      .orderBy(desc(sql`sum(${chefMetricsDaily.payCents})`))
      .limit(limit),
    // busiest — Σ completed shifts
    db
      .select({
        id: chefMetricsDaily.chefId,
        name: chefs.fullName,
        shifts: sql<number>`sum(${chefMetricsDaily.completedShifts})::int`,
      })
      .from(chefMetricsDaily)
      .innerJoin(chefs, eq(chefs.id, chefMetricsDaily.chefId))
      .where(and(gte(chefMetricsDaily.snapshotDate, from), isNull(chefs.deletedAt)))
      .groupBy(chefMetricsDaily.chefId, chefs.fullName)
      .having(sql`sum(${chefMetricsDaily.completedShifts}) > 0`)
      .orderBy(desc(sql`sum(${chefMetricsDaily.completedShifts})`))
      .limit(limit),
    // most reliable — acceptance rate, gated at ≥ PROPOSAL_MIN proposals
    db
      .select({
        id: chefMetricsDaily.chefId,
        name: chefs.fullName,
        accepted: sql<number>`sum(${chefMetricsDaily.proposalsAccepted})::int`,
        total: sql<number>`sum(${chefMetricsDaily.proposalsAccepted} + ${chefMetricsDaily.proposalsRejected})::int`,
      })
      .from(chefMetricsDaily)
      .innerJoin(chefs, eq(chefs.id, chefMetricsDaily.chefId))
      .where(and(gte(chefMetricsDaily.snapshotDate, from), isNull(chefs.deletedAt)))
      .groupBy(chefMetricsDaily.chefId, chefs.fullName)
      .having(sql`sum(${chefMetricsDaily.proposalsAccepted} + ${chefMetricsDaily.proposalsRejected}) >= ${PROPOSAL_MIN}`)
      .orderBy(
        desc(
          sql`sum(${chefMetricsDaily.proposalsAccepted})::float / nullif(sum(${chefMetricsDaily.proposalsAccepted} + ${chefMetricsDaily.proposalsRejected}), 0)`,
        ),
      )
      .limit(limit),
    // highest rated — Σrating / Σcount, gated at ≥ RATING_MIN ratings
    db
      .select({
        id: chefMetricsDaily.chefId,
        name: chefs.fullName,
        sum: sql<number>`sum(${chefMetricsDaily.ratingSum})::int`,
        count: sql<number>`sum(${chefMetricsDaily.ratingCount})::int`,
      })
      .from(chefMetricsDaily)
      .innerJoin(chefs, eq(chefs.id, chefMetricsDaily.chefId))
      .where(and(gte(chefMetricsDaily.snapshotDate, from), isNull(chefs.deletedAt)))
      .groupBy(chefMetricsDaily.chefId, chefs.fullName)
      .having(sql`sum(${chefMetricsDaily.ratingCount}) >= ${RATING_MIN}`)
      .orderBy(
        desc(sql`sum(${chefMetricsDaily.ratingSum})::float / nullif(sum(${chefMetricsDaily.ratingCount}), 0)`),
      )
      .limit(limit),
    // top clients — Σ spend (FINAL hours billed)
    db
      .select({
        id: clientMetricsDaily.clientId,
        name: clients.companyName,
        cents: sql<number>`sum(${clientMetricsDaily.spendCents})::int`,
      })
      .from(clientMetricsDaily)
      .innerJoin(clients, eq(clients.id, clientMetricsDaily.clientId))
      .where(and(gte(clientMetricsDaily.snapshotDate, from), isNull(clients.deletedAt)))
      .groupBy(clientMetricsDaily.clientId, clients.companyName)
      .having(sql`sum(${clientMetricsDaily.spendCents}) > 0`)
      .orderBy(desc(sql`sum(${clientMetricsDaily.spendCents})`))
      .limit(limit),
  ]);

  return {
    windowDays,
    topEarners: earners.map((r) => ({ id: r.id, name: r.name, value: r.cents, display: formatEuro(r.cents) })),
    busiest: busiest.map((r) => ({
      id: r.id,
      name: r.name,
      value: r.shifts,
      display: `${r.shifts} ${r.shifts === 1 ? "dienst" : "diensten"}`,
    })),
    mostReliable: reliable.map((r) => {
      const pct = r.total > 0 ? Math.round((r.accepted / r.total) * 100) : 0;
      return { id: r.id, name: r.name, value: pct, display: `${pct}%`, sub: `${r.accepted}/${r.total} geaccepteerd` };
    }),
    highestRated: rated.map((r) => {
      const avg = r.count > 0 ? r.sum / r.count : 0;
      return {
        id: r.id,
        name: r.name,
        value: Math.round(avg * 10) / 10,
        display: `${(Math.round(avg * 10) / 10).toFixed(1).replace(".", ",")}★`,
        sub: `${r.count} reviews`,
      };
    }),
    topClients: topClients.map((r) => ({ id: r.id, name: r.name, value: r.cents, display: formatEuro(r.cents) })),
  };
}
