/**
 * Snooze/dismiss state for dashboard attention signals (DASH-3b). The signal stays
 * DERIVED from live data; this layer only decides whether to HIDE it right now:
 *  - snoozeUntil in the future → hidden (time-based, auto-reappears).
 *  - dismissedReason set AND the stored fingerprint still matches the live one →
 *    hidden ("ik weet het, het is afgehandeld"); the moment the underlying state
 *    changes (fingerprint differs) the dismiss auto-clears and the signal returns.
 */
import { like } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { dashboardSignalState, type DashboardSignalState } from "@/lib/db/schema";

export type SignalStateMap = Map<string, DashboardSignalState>;

/**
 * HARDEN-1: snooze/dismiss is PER-VIEWER. We store the row under a userId-prefixed
 * key (`<userId>:<rawSignalKey>`) so one operator's snooze never hides a signal from
 * another — without a schema migration (signal_key is free-text; prefixing keeps the
 * PK unique per user+signal). userIds are UUIDs, so `:` and LIKE wildcards can't collide.
 */
export function userSignalKey(userId: string, signalKey: string): string {
  return `${userId}:${signalKey}`;
}

/** Load THIS user's signal-state rows, keyed by the RAW signalKey (prefix stripped) so
 *  callers look it up by the item's signalKey directly. */
export async function loadSignalStates(userId: string): Promise<SignalStateMap> {
  const prefix = `${userId}:`;
  const rows = await db
    .select()
    .from(dashboardSignalState)
    .where(like(dashboardSignalState.signalKey, `${prefix}%`));
  return new Map(rows.map((r) => [r.signalKey.slice(prefix.length), r]));
}

/** Should this signal be hidden from the rail right now? */
export function isSignalHidden(
  state: DashboardSignalState | undefined,
  fingerprint: string | undefined,
  now: Date,
): boolean {
  if (!state) return false;
  if (state.snoozeUntil && new Date(state.snoozeUntil).getTime() > now.getTime()) return true;
  if (state.dismissedReason && state.fingerprint != null && state.fingerprint === (fingerprint ?? "")) return true;
  return false;
}
