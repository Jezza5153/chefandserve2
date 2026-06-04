/**
 * chef-events — PR-CHEF-5. Write structured activity signals for Maarten + AI.
 *
 * Fired behind the scenes from normal chef actions. NEVER blocks the action:
 * a failed insert is logged and swallowed (analytics must not break the portal).
 * Derived signals (responseSeconds, delayFromShiftEndMin, workedVsScheduledMin)
 * are optional — set them only when meaningful for that event.
 */
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefEvents } from "@/lib/db/schema";

export type ChefEventType =
  | "proposal_accepted"
  | "proposal_rejected"
  | "hours_submitted"
  | "hours_rejected"
  | "availability_updated"
  | "shift_cancelled_by_chef";

export async function recordChefEvent(args: {
  chefId: string;
  eventType: ChefEventType;
  entityType?: string;
  entityId?: string;
  responseSeconds?: number | null;
  delayFromShiftEndMin?: number | null;
  workedVsScheduledMin?: number | null;
  payload?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await db.insert(chefEvents).values({
      chefId: args.chefId,
      eventType: args.eventType,
      entityType: args.entityType ?? null,
      entityId: args.entityId ?? null,
      responseSeconds: args.responseSeconds ?? null,
      delayFromShiftEndMin: args.delayFromShiftEndMin ?? null,
      workedVsScheduledMin: args.workedVsScheduledMin ?? null,
      payload: args.payload ?? null,
    });
  } catch (e) {
    console.error("[chef-events] failed to record", args.eventType, e);
  }
}

/** Whole minutes between two instants (b − a), positive when b is later. */
export function diffMinutes(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

/** Whole seconds between two instants (b − a). */
export function diffSeconds(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 1000);
}

export type ChefReliability = {
  totalEvents: number;
  lastActivityAt: Date | null;
  proposalsAccepted: number;
  proposalsRejected: number;
  /** accepted / (accepted + rejected); null when there are no proposals yet. */
  acceptanceRate: number | null;
  /** shift_cancelled_by_chef count — the reliability red flag. */
  cancellations: number;
  hoursSubmitted: number;
  /** avg response time to proposals, in whole minutes; null when no timed responses. */
  avgResponseMinutes: number | null;
};

/**
 * Behaviour-based reliability derived from chef_events — raw signals, NOT a fabricated
 * score. Read-only; safe from any Server Component. A chef with no events yet (e.g. just
 * onboarded) returns zeroed metrics with null rates.
 */
export async function getChefReliability(chefId: string): Promise<ChefReliability> {
  const byType = await db
    .select({ eventType: chefEvents.eventType, count: sql<number>`count(*)::int` })
    .from(chefEvents)
    .where(eq(chefEvents.chefId, chefId))
    .groupBy(chefEvents.eventType);

  const [agg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      last: sql<Date | null>`max(${chefEvents.occurredAt})`,
      avgProposalResp: sql<
        number | null
      >`avg(${chefEvents.responseSeconds}) filter (where ${chefEvents.eventType} in ('proposal_accepted','proposal_rejected'))`,
    })
    .from(chefEvents)
    .where(eq(chefEvents.chefId, chefId));

  const count = (t: ChefEventType) => byType.find((r) => r.eventType === t)?.count ?? 0;
  const accepted = count("proposal_accepted");
  const rejected = count("proposal_rejected");
  const proposals = accepted + rejected;
  const avgResp = agg?.avgProposalResp != null ? Number(agg.avgProposalResp) : null;

  return {
    totalEvents: agg?.total ?? 0,
    lastActivityAt: agg?.last ?? null,
    proposalsAccepted: accepted,
    proposalsRejected: rejected,
    acceptanceRate: proposals > 0 ? accepted / proposals : null,
    cancellations: count("shift_cancelled_by_chef"),
    hoursSubmitted: count("hours_submitted"),
    avgResponseMinutes: avgResp != null ? Math.round(avgResp / 60) : null,
  };
}
