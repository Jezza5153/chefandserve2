/**
 * Snooze/dismiss state for dashboard attention signals (DASH-3b). The signal stays
 * DERIVED from live data; this layer only decides whether to HIDE it right now:
 *  - snoozeUntil in the future → hidden (time-based, auto-reappears).
 *  - dismissedReason set AND the stored fingerprint still matches the live one →
 *    hidden ("ik weet het, het is afgehandeld"); the moment the underlying state
 *    changes (fingerprint differs) the dismiss auto-clears and the signal returns.
 */
import { db } from "@/lib/db/client";
import { dashboardSignalState, type DashboardSignalState } from "@/lib/db/schema";

export type SignalStateMap = Map<string, DashboardSignalState>;

/** Load all signal-state rows into a Map keyed by signalKey. */
export async function loadSignalStates(): Promise<SignalStateMap> {
  const rows = await db.select().from(dashboardSignalState);
  return new Map(rows.map((r) => [r.signalKey, r]));
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
