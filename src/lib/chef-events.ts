/**
 * chef-events — PR-CHEF-5. Write structured activity signals for Maarten + AI.
 *
 * Fired behind the scenes from normal chef actions. NEVER blocks the action:
 * a failed insert is logged and swallowed (analytics must not break the portal).
 * Derived signals (responseSeconds, delayFromShiftEndMin, workedVsScheduledMin)
 * are optional — set them only when meaningful for that event.
 */
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
