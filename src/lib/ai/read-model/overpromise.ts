/**
 * CHEF-PR10 — client "overpromise" read-model.
 *
 * The payoff of the PR-4a clock-out review + planned-vs-actual data: per-client
 * aggregates that answer "which hotels overpromise?" — i.e. clients where shifts
 * routinely run over, the brief didn't match reality, breaks got skipped, or chefs
 * don't want to return.
 *
 * AVG-safe: returns LABELS, RATES and COUNTS only — never a chef's name, never the
 * raw issue note, never sensitive values. Each number is evidence-cited (sample
 * size N), so the AI can quote it honestly. Read-only, no mutations.
 *
 * Shares the per-shift signal definitions with read-model/clockout-signals.ts
 * (same 45-min overrun threshold) so the digest and the report can't disagree.
 */
import { and, eq, gte, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, shiftHourReviews, shiftHours, shifts } from "@/lib/db/schema";
import { OVERRUN_THRESHOLD_MIN } from "@/lib/ai/read-model/clockout-signals";

/** Below this many finalised shifts a client's rates are too noisy to rank. */
export const MIN_SAMPLE = 3;

export type ClientOverpromise = {
  clientId: string;
  company: string | null;
  shifts: number;
  reviews: number;
  /** Share of shifts that ran >= OVERRUN_THRESHOLD_MIN over the planned window (0..1). */
  overrunRate: number;
  avgOverrunMin: number;
  /** Of the shifts WITH a review: share flagged off-brief / no-break / won't-return (0..1). */
  offBriefRate: number;
  noBreakRate: number;
  wontReturnRate: number;
  /** 0..100 composite — higher = promises diverge more from reality. */
  score: number;
};

export type OverpromiseReport = {
  windowDays: number;
  minSample: number;
  totalClients: number;
  clients: ClientOverpromise[];
};

const plannedMinutes = (startsAt: Date, endsAt: Date): number =>
  Math.max(0, Math.round((endsAt.getTime() - startsAt.getTime()) / 60000));

const pct = (n: number, d: number): number => (d > 0 ? n / d : 0);

/**
 * Rank clients by how far the delivered shift diverges from what was promised,
 * over the last `windowDays` of finalised hours. Worst-first; clients below
 * MIN_SAMPLE shifts are excluded (too noisy to be fair).
 */
export async function getOverpromiseByClient(windowDays = 90): Promise<OverpromiseReport> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      clientId: shiftHours.clientId,
      company: clients.companyName,
      workedMinutes: shiftHours.workedMinutes,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      asDescribed: shiftHourReviews.asDescribed,
      gotBreak: shiftHourReviews.gotBreak,
      wouldReturn: shiftHourReviews.wouldReturn,
      reviewId: shiftHourReviews.id,
    })
    .from(shiftHours)
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .leftJoin(clients, eq(clients.id, shiftHours.clientId))
    .leftJoin(shiftHourReviews, eq(shiftHourReviews.placementId, shiftHours.placementId))
    .where(
      and(
        inArray(shiftHours.status, ["submitted", "client_signed", "admin_approved", "exported"]),
        gte(shiftHours.submittedAt, since),
      ),
    );

  type Acc = {
    company: string | null;
    shifts: number;
    reviews: number;
    overrunShifts: number;
    overrunSum: number;
    offBrief: number;
    noBreak: number;
    wontReturn: number;
  };
  const byClient = new Map<string, Acc>();

  for (const r of rows) {
    const key = r.clientId;
    const acc =
      byClient.get(key) ??
      {
        company: r.company,
        shifts: 0,
        reviews: 0,
        overrunShifts: 0,
        overrunSum: 0,
        offBrief: 0,
        noBreak: 0,
        wontReturn: 0,
      };
    acc.shifts++;
    const overrun = (r.workedMinutes ?? 0) - plannedMinutes(r.startsAt, r.endsAt);
    acc.overrunSum += overrun;
    if (overrun >= OVERRUN_THRESHOLD_MIN) acc.overrunShifts++;
    if (r.reviewId) {
      acc.reviews++;
      if (r.asDescribed === false) acc.offBrief++;
      if (r.gotBreak === false) acc.noBreak++;
      if (r.wouldReturn === false) acc.wontReturn++;
    }
    byClient.set(key, acc);
  }

  const clientsOut: ClientOverpromise[] = [];
  for (const [clientId, a] of byClient.entries()) {
    if (a.shifts < MIN_SAMPLE) continue;
    const overrunRate = pct(a.overrunShifts, a.shifts);
    const offBriefRate = pct(a.offBrief, a.reviews);
    const noBreakRate = pct(a.noBreak, a.reviews);
    const wontReturnRate = pct(a.wontReturn, a.reviews);
    // Composite (0..100): overrun + off-brief + no-break + won't-return, weighted.
    const score = Math.round(
      100 *
        Math.min(
          1,
          0.35 * overrunRate + 0.25 * offBriefRate + 0.2 * noBreakRate + 0.2 * wontReturnRate,
        ),
    );
    clientsOut.push({
      clientId,
      company: a.company,
      shifts: a.shifts,
      reviews: a.reviews,
      overrunRate,
      avgOverrunMin: Math.round(a.overrunSum / a.shifts),
      offBriefRate,
      noBreakRate,
      wontReturnRate,
      score,
    });
  }
  clientsOut.sort((x, y) => y.score - x.score);

  return {
    windowDays,
    minSample: MIN_SAMPLE,
    totalClients: clientsOut.length,
    clients: clientsOut,
  };
}
