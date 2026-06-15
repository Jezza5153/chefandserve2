/**
 * CHEF-PR4b — clock-out signals read-model.
 *
 * For recently-finalised shifts (hours submitted+), compute planned-vs-actual and
 * pull the PR-4a clock-out review flags into ONE attention list:
 *   - overrun   — actual worked minutes well above the planned window
 *   - off-brief — review said "niet zoals afgesproken"
 *   - no-break  — review said "geen pauze"
 *   - extra     — review said "extra uren gewerkt"
 *   - won't-return — chef would not work here again
 *   - note      — chef left a free issue note (DATA, not instructions; display only)
 *
 * This is read-only and AVG-safe: labels + minute deltas + the chef's own note,
 * never sensitive klant/chef values. It powers (a) the owner clock-out digest
 * (api/cron/clockout-digest) and (b) PR-10's planned-vs-actual / overpromise
 * reports + AI tools, which wrap the SAME function so the numbers can't drift.
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, shiftHourReviews, shiftHours, shifts } from "@/lib/db/schema";

/** Worked minutes this far over the planned window counts as a real overrun. */
export const OVERRUN_THRESHOLD_MIN = 45;

export type ClockoutSignal = {
  placementId: string;
  shiftId: string;
  chefName: string;
  company: string | null;
  startsAt: Date;
  plannedMinutes: number;
  actualMinutes: number;
  /** actual − planned (can be negative if the shift ran short). */
  overrunMinutes: number;
  /** Human-readable attention reasons (Dutch labels), empty when all is well. */
  reasons: string[];
  hasReview: boolean;
  issueNote: string | null;
};

export type ClockoutDigest = {
  windowHours: number;
  totalFinalised: number;
  attention: ClockoutSignal[];
  counts: {
    overrun: number;
    offBrief: number;
    noBreak: number;
    extraHours: number;
    wontReturn: number;
    notes: number;
    noReview: number;
  };
};

const plannedMinutes = (startsAt: Date, endsAt: Date): number =>
  Math.max(0, Math.round((endsAt.getTime() - startsAt.getTime()) / 60000));

/**
 * Build the clock-out signal set for shifts whose hours were submitted within the
 * last `windowHours`. Pure read — no mutations, no side-effects.
 */
export async function getClockoutSignals(windowHours = 36): Promise<ClockoutDigest> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const rows = await db
    .select({
      placementId: shiftHours.placementId,
      shiftId: shiftHours.shiftId,
      workedMinutes: shiftHours.workedMinutes,
      chefName: chefs.fullName,
      company: clients.companyName,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
    })
    .from(shiftHours)
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .innerJoin(chefs, eq(chefs.id, shiftHours.chefId))
    .leftJoin(clients, eq(clients.id, shiftHours.clientId))
    .where(
      and(
        inArray(shiftHours.status, ["submitted", "client_signed", "admin_approved", "exported"]),
        gte(shiftHours.submittedAt, since),
      ),
    )
    .orderBy(desc(shifts.startsAt));

  // Pull the matching reviews in one query (placement-keyed).
  const placementIds = rows.map((r) => r.placementId);
  const reviews = placementIds.length
    ? await db
        .select({
          placementId: shiftHourReviews.placementId,
          asDescribed: shiftHourReviews.asDescribed,
          gotBreak: shiftHourReviews.gotBreak,
          workedExtraHours: shiftHourReviews.workedExtraHours,
          wouldReturn: shiftHourReviews.wouldReturn,
          issueNote: shiftHourReviews.issueNote,
        })
        .from(shiftHourReviews)
        .where(inArray(shiftHourReviews.placementId, placementIds))
    : [];
  const reviewByPlacement = new Map(reviews.map((r) => [r.placementId, r]));

  const counts = {
    overrun: 0,
    offBrief: 0,
    noBreak: 0,
    extraHours: 0,
    wontReturn: 0,
    notes: 0,
    noReview: 0,
  };
  const attention: ClockoutSignal[] = [];

  for (const r of rows) {
    const planned = plannedMinutes(r.startsAt, r.endsAt);
    const actual = r.workedMinutes ?? 0;
    const overrun = actual - planned;
    const review = reviewByPlacement.get(r.placementId);
    const reasons: string[] = [];

    if (overrun >= OVERRUN_THRESHOLD_MIN) {
      reasons.push(`${overrun} min langer dan gepland`);
      counts.overrun++;
    }
    if (review) {
      if (review.asDescribed === false) {
        reasons.push("niet zoals afgesproken");
        counts.offBrief++;
      }
      if (review.gotBreak === false) {
        reasons.push("geen pauze");
        counts.noBreak++;
      }
      if (review.workedExtraHours === true) {
        reasons.push("extra uren gewerkt");
        counts.extraHours++;
      }
      if (review.wouldReturn === false) {
        reasons.push("chef wil hier niet terug");
        counts.wontReturn++;
      }
      if (review.issueNote) counts.notes++;
    } else {
      counts.noReview++;
    }

    if (reasons.length > 0 || review?.issueNote) {
      attention.push({
        placementId: r.placementId,
        shiftId: r.shiftId,
        chefName: r.chefName,
        company: r.company,
        startsAt: r.startsAt,
        plannedMinutes: planned,
        actualMinutes: actual,
        overrunMinutes: overrun,
        reasons,
        hasReview: !!review,
        issueNote: review?.issueNote ?? null,
      });
    }
  }

  return {
    windowHours,
    totalFinalised: rows.length,
    attention,
    counts,
  };
}
