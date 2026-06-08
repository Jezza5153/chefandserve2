/**
 * client-history — KPI-3. The Klant 360 read model. Two layers, both honest:
 *  - getClientSummary(): point-in-time truth from the LIVE tables (mirrors
 *    chef-history.ts). Money from FINAL shift_hours only (admin_approved/exported);
 *    fill-rate measured over REALIZED (already-started) shifts so a future open
 *    shift never counts as an unfilled "miss"; rotation/retention from completed
 *    placements; ratings the klant GAVE; sign-off SLA = submit → client-sign latency.
 *  - buildClientTrends(): pure 8-week trends over client_metrics_daily snapshot rows
 *    (KPI-1), reusing the metrics-history re-shapers + the shared noise guard.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, placements, ratings, shiftHours, shifts } from "@/lib/db/schema";
import { computeClientHealth, type ClientHealthVerdict } from "@/lib/domain/client-health";
import {
  bucketByWeek,
  periodDelta,
  weightedAvg,
  windowSum,
  type ClientMetricsDaily,
  type PeriodDelta,
} from "@/lib/domain/metrics-history";

/** shift_hours statuses that count as actually-worked, paid-grade hours. */
const FINAL_HOURS_STATUSES = ["admin_approved", "exported"] as const;

export type ClientSummary = {
  totalShifts: number;
  completedShifts: number;
  openShifts: number;
  upcomingShifts: number;
  realizedSlots: number; // Σ headcount of shifts that have started
  realizedFilled: number; // confirmed/completed placements on those shifts
  fillRate: number | null; // realizedFilled / realizedSlots, null if no realized slots
  totalHoursWorked: number;
  spendCents: number; // what the klant is billed (client rate, FINAL)
  loonCostCents: number; // agency chef cost (chef rate, FINAL)
  marginCents: number;
  distinctChefs: number;
  repeatChefs: number; // chefs who worked here ≥ 2×
  topChefs: { name: string; count: number }[];
  ratingsGiven: number;
  averageRatingGiven: number | null;
  signoffAvgHours: number | null; // avg submit → client-sign latency
  pendingSignoff: number; // submitted hours awaiting this klant's signature
};

export async function getClientSummary(clientId: string): Promise<ClientSummary> {
  const [[shiftStats], [filled], [money], chefRows, [rating], [signoff], [pending]] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${shifts.status} = 'completed')::int`,
        open: sql<number>`count(*) filter (where ${shifts.status} = 'open')::int`,
        upcoming: sql<number>`count(*) filter (where ${shifts.startsAt} > now())::int`,
        realizedSlots: sql<number>`coalesce(sum(${shifts.headcount}) filter (where ${shifts.startsAt} <= now()), 0)::int`,
      })
      .from(shifts)
      .where(eq(shifts.clientId, clientId)),
    db
      .select({ filled: sql<number>`count(*)::int` })
      .from(placements)
      .innerJoin(shifts, eq(shifts.id, placements.shiftId))
      .where(
        and(
          eq(shifts.clientId, clientId),
          sql`${shifts.startsAt} <= now()`,
          inArray(placements.status, ["confirmed", "completed"]),
        ),
      ),
    db
      .select({
        minutes: sql<number>`coalesce(sum(${shiftHours.workedMinutes}), 0)::int`,
        spend: sql<number>`coalesce(sum(round(${shiftHours.workedMinutes} / 60.0 * ${shiftHours.clientRateCents})), 0)::int`,
        loon: sql<number>`coalesce(sum(round(${shiftHours.workedMinutes} / 60.0 * ${shiftHours.chefRateCents})), 0)::int`,
      })
      .from(shiftHours)
      .where(and(eq(shiftHours.clientId, clientId), inArray(shiftHours.status, [...FINAL_HOURS_STATUSES]))),
    db
      .select({ name: chefs.fullName, count: sql<number>`count(*)::int` })
      .from(placements)
      .innerJoin(shifts, eq(shifts.id, placements.shiftId))
      .innerJoin(chefs, eq(chefs.id, placements.chefId))
      .where(and(eq(shifts.clientId, clientId), eq(placements.status, "completed")))
      .groupBy(chefs.fullName)
      .orderBy(sql`count(*) desc`),
    db
      .select({
        avg: sql<number | null>`round(avg(${ratings.stars})::numeric, 1)`,
        n: sql<number>`count(*)::int`,
      })
      .from(ratings)
      .where(eq(ratings.clientId, clientId)),
    db
      .select({
        avgMin: sql<number | null>`avg(extract(epoch from (${shiftHours.clientSignedAt} - ${shiftHours.submittedAt})) / 60)`,
      })
      .from(shiftHours)
      .where(
        and(
          eq(shiftHours.clientId, clientId),
          sql`${shiftHours.clientSignedAt} is not null`,
          sql`${shiftHours.submittedAt} is not null`,
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(shiftHours)
      .where(
        and(
          eq(shiftHours.clientId, clientId),
          sql`${shiftHours.clientSignedAt} is null`,
          sql`${shiftHours.submittedAt} is not null`,
        ),
      ),
  ]);

  const realizedSlots = shiftStats?.realizedSlots ?? 0;
  const realizedFilled = filled?.filled ?? 0;
  const spendCents = money?.spend ?? 0;
  const loonCostCents = money?.loon ?? 0;
  const avgMin = signoff?.avgMin != null ? Number(signoff.avgMin) : null;

  return {
    totalShifts: shiftStats?.total ?? 0,
    completedShifts: shiftStats?.completed ?? 0,
    openShifts: shiftStats?.open ?? 0,
    upcomingShifts: shiftStats?.upcoming ?? 0,
    realizedSlots,
    realizedFilled,
    fillRate: realizedSlots > 0 ? realizedFilled / realizedSlots : null,
    totalHoursWorked: Math.round((money?.minutes ?? 0) / 60),
    spendCents,
    loonCostCents,
    marginCents: spendCents - loonCostCents,
    distinctChefs: chefRows.length,
    repeatChefs: chefRows.filter((c) => c.count >= 2).length,
    topChefs: chefRows.slice(0, 5).map((c) => ({ name: c.name, count: c.count })),
    ratingsGiven: rating?.n ?? 0,
    averageRatingGiven: rating?.avg != null ? Number(rating.avg) : null,
    signoffAvgHours: avgMin != null ? Math.round((avgMin / 60) * 10) / 10 : null,
    pendingSignoff: pending?.n ?? 0,
  };
}

/**
 * Klant 360 verdict — getClientSummary() signals + clients.status → the "goede klant?" verdict
 * (computeClientHealth). Returns null when the client doesn't exist. Used by the admin client
 * detail card + the owner `clients.health` AI tool.
 */
export async function getClientHealth(
  clientId: string,
): Promise<{ summary: ClientSummary; verdict: ClientHealthVerdict } | null> {
  const [c] = await db.select({ status: clients.status }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!c) return null;
  const summary = await getClientSummary(clientId);
  const verdict = computeClientHealth({
    status: c.status,
    completedShifts: summary.completedShifts,
    upcomingShifts: summary.upcomingShifts,
    marginCents: summary.marginCents,
    spendCents: summary.spendCents,
    repeatChefs: summary.repeatChefs,
    ratingsGiven: summary.ratingsGiven,
    pendingSignoff: summary.pendingSignoff,
    signoffAvgHours: summary.signoffAvgHours,
  });
  return { summary, verdict };
}

/* ----- trends over the snapshot (pure) ------------------------------------ */

export type ClientTrends = {
  hasEnoughHistory: boolean;
  weeks: number;
  spendSparkline: number[]; // euro
  marginSparkline: number[]; // euro
  shiftsSparkline: number[]; // count
  spendDelta: PeriodDelta; // euro
  marginDelta: PeriodDelta; // euro
  shiftsDelta: PeriodDelta; // count
  fillRate28d: number | null;
  ratingAvg28d: number | null;
};

function midnightUTC(d: Date): number {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x.getTime();
}

export function buildClientTrends(series: ClientMetricsDaily[], today: Date = new Date()): ClientTrends {
  const WEEKS = 8;
  const earliest = series[0]?.snapshotDate;
  const hasEnoughHistory =
    earliest != null &&
    Math.floor((midnightUTC(today) - new Date(`${earliest}T00:00:00Z`).getTime()) / 86_400_000) >= 14;

  const round = (d: PeriodDelta): PeriodDelta => ({
    ...d,
    thisPeriod: Math.round(d.thisPeriod),
    prevPeriod: Math.round(d.prevPeriod),
    diff: Math.round(d.diff),
  });

  const slots28 = windowSum(series, (r) => r.slotsCount, 28, today);
  const filled28 = windowSum(series, (r) => r.filledSlots, 28, today);

  return {
    hasEnoughHistory,
    weeks: WEEKS,
    spendSparkline: bucketByWeek(series, (r) => r.spendCents, WEEKS, today).map((c) => Math.round(c / 100)),
    marginSparkline: bucketByWeek(series, (r) => r.marginCents, WEEKS, today).map((c) => Math.round(c / 100)),
    shiftsSparkline: bucketByWeek(series, (r) => r.shiftsCount, WEEKS, today),
    spendDelta: round(periodDelta(series, (r) => r.spendCents / 100, today)),
    marginDelta: round(periodDelta(series, (r) => r.marginCents / 100, today)),
    shiftsDelta: periodDelta(series, (r) => r.shiftsCount, today),
    fillRate28d: slots28 > 0 ? filled28 / slots28 : null,
    ratingAvg28d: weightedAvg(series, (r) => r.ratingSum, (r) => r.ratingCount, 28, today),
  };
}
