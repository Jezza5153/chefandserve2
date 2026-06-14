/**
 * KPI read-models for the owner assistant (AI audit Wave 1) — the "profitability cockpit"
 * questions the UI already answers but the AI couldn't. All read-only, cents→euro for the
 * brain, and every heavy query reuses an EXISTING tested domain function (no new business
 * logic) except the signoff-backlog aggregate (one grouped query, neon-http-safe).
 */
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, shiftHours } from "@/lib/db/schema";
import {
  detectSwing,
  getClientRevenueBreakdown,
  getPlatformTimeSeries,
  type TimeBucket,
} from "@/lib/domain/reporting";
import { getUnbilledHoursByClient } from "@/lib/domain/invoicing";
import { getReactivationChefs } from "@/lib/domain/intel";

const eur = (cents: number) => Math.round(cents / 100);

/** Clients running a negative margin over the window — ranked most-loss-making first. */
export async function lossMakingClients(rangeDays = 30) {
  const rows = await getClientRevenueBreakdown(rangeDays, { limit: 200 });
  const losing = rows
    .filter((r) => r.marginCents < 0)
    .sort((a, b) => a.marginCents - b.marginCents)
    .map((r) => ({ name: r.name, revenueEur: eur(r.revenueCents), marginEur: eur(r.marginCents), detail: r.detail }));
  return { rangeDays, count: losing.length, clients: losing };
}

/** Approved-but-uninvoiced hours per client — "wat kan ik nog factureren". Wraps the cockpit nudge. */
export async function unbilledByClient() {
  const rows = await getUnbilledHoursByClient();
  return {
    count: rows.length,
    totalEur: eur(rows.reduce((a, r) => a + r.totalCents, 0)),
    clients: rows.map((r) => ({
      name: r.companyName,
      hours: r.hoursCount,
      amountEur: eur(r.totalCents),
      oldestShift: r.oldestShiftDate,
    })),
  };
}

/** Platform revenue/margin/fill-rate trend over week or month buckets + anomaly swings. */
export async function platformKpiTrend(bucket: TimeBucket = "month") {
  const series = await getPlatformTimeSeries({ bucket });
  const revenueSwing = detectSwing(series.points, "revenueCents");
  const marginSwing = detectSwing(series.points, "marginCents");
  return {
    bucket,
    points: series.points.map((p) => ({
      label: p.label,
      revenueEur: eur(p.revenueCents),
      marginEur: eur(p.marginCents),
      fillRate: p.fillRate,
    })),
    totals: { revenueEur: eur(series.totals.revenueCents), marginEur: eur(series.totals.marginCents), fillRate: series.totals.fillRate },
    revenueSwing: revenueSwing ? { pct: revenueSwing.pct, direction: revenueSwing.direction } : null,
    marginSwing: marginSwing ? { pct: marginSwing.pct, direction: marginSwing.direction } : null,
  };
}

/** Good chefs gone quiet — completed track record but idle ≥ threshold, churn-risk ranked. */
export async function atRiskChefs() {
  const rows = await getReactivationChefs();
  return {
    count: rows.length,
    chefs: rows.map((r) => ({ name: r.fullName, daysSinceLastShift: r.daysSince, completedShifts: r.completedShifts })),
  };
}

/**
 * Clients with hours awaiting THEIR signature (submitted, not yet client-signed), ranked by
 * count, with how long the oldest has been waiting. One grouped query + JS fold (the
 * per-row filter aggregates stay in the GROUP BY, never a projection subquery).
 */
export async function signoffBacklog() {
  const rows = await db
    .select({
      clientId: shiftHours.clientId,
      name: clients.companyName,
      pending: sql<number>`count(*) filter (where ${shiftHours.clientSignedAt} is null and ${shiftHours.submittedAt} is not null)::int`,
      maxWaitDays: sql<
        number | null
      >`round(max(extract(epoch from (now() - ${shiftHours.submittedAt})) / 86400) filter (where ${shiftHours.clientSignedAt} is null and ${shiftHours.submittedAt} is not null))`,
    })
    .from(shiftHours)
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .groupBy(shiftHours.clientId, clients.companyName);
  const backlog = rows
    .filter((r) => r.pending > 0)
    .sort((a, b) => b.pending - a.pending)
    .map((r) => ({ name: r.name, pending: r.pending, oldestWaitingDays: r.maxWaitDays != null ? Number(r.maxWaitDays) : null }));
  return { count: backlog.length, totalPending: backlog.reduce((a, r) => a + r.pending, 0), clients: backlog };
}
