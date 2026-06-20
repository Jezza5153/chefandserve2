/**
 * Emergency detection + escalation lifecycle (Phase 4, P4a). The OWNER-side incident
 * layer: DERIVED detection over existing data opens `escalations` rows; humans/AI resolve
 * or stand them down. PURE classifiers (the time-window + threshold logic) are split out
 * so the boundaries are unit-testable; the async fns do the I/O.
 *
 * Dark behind EMERGENCY_MODE_ENABLED (and the chef_signal trigger additionally behind
 * SHIFT_SIGNALS_ENABLED — it READS the parallel-lane shift_signals table, never writes
 * it). Idempotent on two axes: (1) the escalations_open_unique partial index collapses
 * re-detection of a still-OPEN emergency to one row; (2) detection ALSO filters out what
 * the owner already resolved/stood down (filterReopenSuppressed) so a close sticks instead
 * of re-opening every scan — event-based kinds re-open only on a NEW trigger, condition-
 * based kinds stay suppressed for a per-kind cooldown. neon-http: single atomic statements;
 * resolve/standDown pair the UPDATE + audit in withTx. AVG: `reason` is a machine-built
 * Dutch one-liner — the chef's free-text signal `detail` is NEVER copied in.
 *
 * No next/headers import → worker/script-safe. Tested in scripts/smoke-p4a-emergencies.ts.
 */
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { withTx } from "@/lib/db/tx";
import { recordAuditCore } from "@/lib/audit";
import { clients, escalations, placements, shiftSignals, shifts } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { shiftSignalsEnabled } from "@/lib/domain/shift-signals";

const MS_HOUR = 3_600_000;
const TERMINAL = ["cancelled", "completed"];

export function emergencyModeEnabled(): boolean {
  return env.EMERGENCY_MODE_ENABLED === "true";
}

export type EmergencyKind =
  | "chef_cancelled_late"
  | "unassigned_soon"
  | "unconfirmed_near_start"
  | "chef_signal";
export type EmergencySeverity = "red" | "amber";
export type DetectedEmergency = {
  shiftId: string;
  placementId: string | null;
  kind: EmergencyKind;
  reason: string;
  severity: EmergencySeverity;
  /**
   * P4d: the triggering EVENT time, set only for event-based kinds (chef_cancelled_late =
   * cancelledAt, chef_signal = signal.createdAt). Lets re-detection re-open one of these
   * only when a NEW event arrived after the owner's last resolve/stand-down. Condition-
   * based kinds (unassigned_soon, unconfirmed_near_start) leave it null and instead stay
   * suppressed for a per-kind cooldown.
   */
  triggerAt?: Date | string | null;
};

/**
 * P4d cooldown for the CONDITION-based kinds: once an owner resolves/stands one down, the
 * same (shift, kind) stays suppressed for this long so a continuous condition doesn't
 * re-open every 60s scan. ≈ each kind's own detection window, so suppression lasts until
 * the condition naturally expires (the shift starts). Event-based kinds don't use this.
 */
const REOPEN_COOLDOWN_HOURS: Partial<Record<EmergencyKind, number>> = {
  unassigned_soon: 12,
  unconfirmed_near_start: 4,
};

/* ---- PURE classifiers (key-free, unit-tested) ---- */

const URGENT_SIGNAL_KINDS = new Set(["hulp", "onveilig", "vertraagd"]);
export function isUrgentSignalKind(kind: string): boolean {
  return URGENT_SIGNAL_KINDS.has(kind);
}
function hoursUntil(start: Date | string, now: Date): number {
  return (new Date(start).getTime() - now.getTime()) / MS_HOUR;
}
function isTerminal(status: string): boolean {
  return TERMINAL.includes(status);
}

/** A CONFIRMED chef pulled out and the shift starts within 24h. */
export function classifyCancelledLate(
  p: { id: string; status: string; confirmedAt: Date | string | null; cancelledAt: Date | string | null },
  shift: { id: string; startsAt: Date | string; status: string },
  now: Date,
): DetectedEmergency | null {
  if (p.status !== "cancelled" || !p.confirmedAt || !p.cancelledAt) return null;
  if (isTerminal(shift.status)) return null;
  const h = hoursUntil(shift.startsAt, now);
  if (h <= 0 || h >= 24) return null;
  return {
    shiftId: shift.id,
    placementId: p.id,
    kind: "chef_cancelled_late",
    reason: "Bevestigde chef trok zich laat terug — dienst start binnen 24u.",
    severity: "red",
    triggerAt: p.cancelledAt,
  };
}

/** Shift starts within 12h and is still under headcount. */
export function classifyUnassignedSoon(
  shift: { id: string; startsAt: Date | string; status: string; headcount: number | null; filled: number },
  now: Date,
): DetectedEmergency | null {
  if (isTerminal(shift.status)) return null;
  const h = hoursUntil(shift.startsAt, now);
  if (h <= 0 || h >= 12) return null;
  const headcount = shift.headcount ?? 1;
  const open = Math.max(headcount - shift.filled, 0);
  if (open <= 0) return null;
  return {
    shiftId: shift.id,
    placementId: null,
    kind: "unassigned_soon",
    reason: `Dienst start binnen 12u en is nog niet vol (${shift.filled}/${headcount} bemand).`,
    severity: shift.filled === 0 ? "red" : "amber",
  };
}

/** Chef accepted but the planner never confirmed, and the shift is imminent (<4h). */
export function classifyUnconfirmedNearStart(
  p: { id: string; status: string; confirmedAt: Date | string | null },
  shift: { id: string; startsAt: Date | string; status: string },
  now: Date,
): DetectedEmergency | null {
  if (p.status !== "accepted" || p.confirmedAt) return null;
  if (isTerminal(shift.status)) return null;
  const h = hoursUntil(shift.startsAt, now);
  if (h <= 0 || h >= 4) return null;
  return {
    shiftId: shift.id,
    placementId: p.id,
    kind: "unconfirmed_near_start",
    reason: "Chef accepteerde maar is niet bevestigd — dienst start binnen 4u.",
    severity: "amber",
  };
}

/** Chef raised an urgent in-shift signal (hulp/onveilig/vertraagd) within the last 6h. */
export function classifyChefSignal(
  sig: { placementId: string | null; shiftId: string; kind: string; createdAt: Date | string },
  shift: { status: string },
  now: Date,
): DetectedEmergency | null {
  if (!isUrgentSignalKind(sig.kind)) return null;
  if (isTerminal(shift.status)) return null;
  const ageH = (now.getTime() - new Date(sig.createdAt).getTime()) / MS_HOUR;
  if (ageH < 0 || ageH >= 6) return null;
  const label = sig.kind === "onveilig" ? "voelt zich niet veilig" : sig.kind === "hulp" ? "vraagt om hulp" : "is vertraagd";
  return {
    shiftId: sig.shiftId,
    placementId: sig.placementId,
    kind: "chef_signal",
    reason: `Chef ${label} — urgent signaal tijdens de dienst.`,
    severity: sig.kind === "vertraagd" ? "amber" : "red",
    triggerAt: sig.createdAt,
  };
}

/* ---- P4d re-open suppression (pure, unit-tested) ---- */

export type ClosedEscalationRow = { shiftId: string; kind: string; resolvedAt: Date | string | null };

/**
 * Drop candidates the owner already closed, so a resolve/stand-down actually sticks instead
 * of re-opening on the next scan (the partial unique index only collapses open-vs-open).
 *  - event-based kinds (triggerAt set): re-open ONLY when a trigger newer than the last
 *    close arrived (a genuinely new cancellation / urgent signal) — else suppress.
 *  - condition-based kinds (no triggerAt): suppress while still within the per-kind cooldown
 *    after the most recent close; the condition expires before the cooldown does.
 * Pure: the caller loads the recently-closed rows; this just filters.
 */
export function filterReopenSuppressed(
  candidates: DetectedEmergency[],
  closed: ClosedEscalationRow[],
  now: Date,
): DetectedEmergency[] {
  const latestClose = new Map<string, number>();
  for (const c of closed) {
    if (!c.resolvedAt) continue;
    const k = c.shiftId + ":" + c.kind;
    const t = new Date(c.resolvedAt).getTime();
    const prev = latestClose.get(k);
    if (prev === undefined || t > prev) latestClose.set(k, t);
  }
  return candidates.filter((e) => {
    const closeT = latestClose.get(e.shiftId + ":" + e.kind);
    if (closeT === undefined) return true; // never closed → keep
    if (e.triggerAt != null) return new Date(e.triggerAt).getTime() > closeT; // new event since close?
    const cooldownH = REOPEN_COOLDOWN_HOURS[e.kind] ?? 12;
    return closeT <= now.getTime() - cooldownH * MS_HOUR; // cooldown elapsed?
  });
}

/* ---- detection read-model (SELECT only, no side effects) ---- */

/** Run the 4 triggers over current data → deduped DetectedEmergency[] (one per
 *  shift+kind, red first). chef_signal skipped unless the signals lane is on. */
export async function detectEmergencies(opts?: { now?: Date }): Promise<DetectedEmergency[]> {
  const now = opts?.now ?? new Date();
  const horizon = new Date(now.getTime() + 24 * MS_HOUR);

  // Future, non-terminal shifts within 24h → triggers 1-3.
  const shiftRows = await db
    .select({ id: shifts.id, startsAt: shifts.startsAt, status: shifts.status, headcount: shifts.headcount })
    .from(shifts)
    .where(and(gt(shifts.startsAt, now), lt(shifts.startsAt, horizon), sql`${shifts.status} NOT IN ('cancelled','completed')`));

  const out = new Map<string, DetectedEmergency>();
  const add = (e: DetectedEmergency | null) => {
    if (!e) return;
    const k = e.shiftId + ":" + e.kind;
    const prev = out.get(k);
    if (!prev) {
      out.set(k, e);
      return;
    }
    // Event-based collision (two cancellations / signals on one shift): keep the LATEST
    // event as the representative, so re-open suppression compares against the newest trigger.
    if (e.triggerAt && prev.triggerAt && new Date(e.triggerAt).getTime() > new Date(prev.triggerAt).getTime()) {
      out.set(k, e);
    }
  };

  if (shiftRows.length > 0) {
    const shiftIds = shiftRows.map((s) => s.id);
    const shiftById = new Map(shiftRows.map((s) => [s.id, s]));

    const filledRows = await db
      .select({ shiftId: placements.shiftId, n: sql<number>`count(*)::int` })
      .from(placements)
      .where(and(inArray(placements.shiftId, shiftIds), inArray(placements.status, ["confirmed", "accepted"])))
      .groupBy(placements.shiftId);
    const filledBy = new Map(filledRows.map((r) => [r.shiftId, r.n]));

    for (const s of shiftRows) {
      add(classifyUnassignedSoon({ id: s.id, startsAt: s.startsAt, status: s.status, headcount: s.headcount, filled: filledBy.get(s.id) ?? 0 }, now));
    }

    const plRows = await db
      .select({ id: placements.id, shiftId: placements.shiftId, status: placements.status, confirmedAt: placements.confirmedAt, cancelledAt: placements.cancelledAt })
      .from(placements)
      .where(inArray(placements.shiftId, shiftIds));
    for (const p of plRows) {
      const s = shiftById.get(p.shiftId);
      if (!s) continue;
      add(classifyCancelledLate(p, { id: s.id, startsAt: s.startsAt, status: s.status }, now));
      add(classifyUnconfirmedNearStart(p, { id: s.id, startsAt: s.startsAt, status: s.status }, now));
    }
  }

  // chef_signal — recent urgent signals on non-terminal shifts (incl. in-progress, so it
  // is NOT bounded by the 24h-future window above). Gated on the signals lane.
  if (shiftSignalsEnabled()) {
    const since = new Date(now.getTime() - 6 * MS_HOUR);
    const sigRows = await db
      .select({ placementId: shiftSignals.placementId, shiftId: shiftSignals.shiftId, kind: shiftSignals.kind, createdAt: shiftSignals.createdAt, shiftStatus: shifts.status })
      .from(shiftSignals)
      .innerJoin(shifts, eq(shifts.id, shiftSignals.shiftId))
      .where(and(inArray(shiftSignals.kind, ["hulp", "onveilig", "vertraagd"]), gt(shiftSignals.createdAt, since), sql`${shifts.status} NOT IN ('cancelled','completed')`));
    for (const sig of sigRows) {
      add(classifyChefSignal({ placementId: sig.placementId, shiftId: sig.shiftId, kind: sig.kind, createdAt: sig.createdAt }, { status: sig.shiftStatus }, now));
    }
  }

  // P4d: suppress what the owner already resolved/stood down, so a stand-down sticks rather
  // than re-opening every scan. Load only the recently-closed rows for the candidate shifts
  // (24h covers the widest detection window); the pure filter applies the per-kind rule.
  let candidates = [...out.values()];
  if (candidates.length > 0) {
    const shiftIds = [...new Set(candidates.map((c) => c.shiftId))];
    const closedSince = new Date(now.getTime() - 24 * MS_HOUR);
    const closedRows = await db
      .select({ shiftId: escalations.shiftId, kind: escalations.kind, resolvedAt: escalations.resolvedAt })
      .from(escalations)
      .where(
        and(
          inArray(escalations.shiftId, shiftIds),
          inArray(escalations.status, ["resolved", "stood_down"]),
          gt(escalations.resolvedAt, closedSince),
        ),
      );
    candidates = filterReopenSuppressed(candidates, closedRows, now);
  }

  return candidates.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "red" ? -1 : 1));
}

/* ---- idempotent CRUD ---- */

export type OpenResult = { ok: true; id: string; created: boolean } | { ok: false; error: "db" };

/**
 * Idempotent open via the escalations_open_unique partial index: INSERT … ON CONFLICT
 * (shift_id, kind) WHERE status IN ('open','in_progress') DO NOTHING. created=false when
 * an open row already existed (re-detection is harmless). openedBy null = system detection.
 */
export async function openEscalation(args: {
  shiftId: string;
  kind: EmergencyKind;
  reason: string;
  placementId?: string | null;
  openedBy?: string | null;
}): Promise<OpenResult> {
  try {
    const inserted = await db
      .insert(escalations)
      .values({
        shiftId: args.shiftId,
        kind: args.kind,
        reason: args.reason,
        placementId: args.placementId ?? null,
        openedBy: args.openedBy ?? null,
      })
      .onConflictDoNothing({
        target: [escalations.shiftId, escalations.kind],
        where: sql`${escalations.status} IN ('open','in_progress')`,
      })
      .returning({ id: escalations.id });

    if (inserted.length > 0) {
      // Only audit a HUMAN/AI open — system detection's record IS the row.
      if (args.openedBy) {
        await recordAuditCore({
          userId: args.openedBy,
          action: "escalation.opened",
          resource: "escalations",
          resourceId: inserted[0].id,
          after: { kind: args.kind, shiftId: args.shiftId },
        }).catch(() => {});
      }
      return { ok: true, id: inserted[0].id, created: true };
    }
    // Conflict — return the existing open row's id.
    const [existing] = await db
      .select({ id: escalations.id })
      .from(escalations)
      .where(and(eq(escalations.shiftId, args.shiftId), eq(escalations.kind, args.kind), inArray(escalations.status, ["open", "in_progress"])))
      .limit(1);
    return existing ? { ok: true, id: existing.id, created: false } : { ok: false, error: "db" };
  } catch (e) {
    console.error("[openEscalation]", e);
    return { ok: false, error: "db" };
  }
}

/** Detect + open each. Returns counts. P4b's on-page detection (and the deferred cron)
 *  call this; no-op when EMERGENCY_MODE_ENABLED is off. */
export async function syncEmergencies(opts?: { now?: Date }): Promise<{ detected: number; opened: number }> {
  if (!emergencyModeEnabled()) return { detected: 0, opened: 0 };
  const detected = await detectEmergencies(opts);
  let opened = 0;
  for (const e of detected) {
    const r = await openEscalation({ shiftId: e.shiftId, kind: e.kind, reason: e.reason, placementId: e.placementId });
    if (r.ok && r.created) opened++;
  }
  return { detected: detected.length, opened };
}

export type CloseResult = { ok: true } | { ok: false; error: "wrong_status" };

/** Atomic open|in_progress → resolved + audit, in one tx. resolvedBy is auth-resolved at
 *  the caller (never form data). 0 rows ⇒ already-closed ⇒ wrong_status (no double-audit). */
export async function resolveEscalation(args: {
  escalationId: string;
  resolvedBy: string;
  resolutionNotes?: string | null;
  replacementPlacementId?: string | null;
}): Promise<CloseResult> {
  return closeEscalation("resolved", "escalation.resolved", args);
}

/** Atomic open|in_progress → stood_down (false alarm / handled elsewhere) + audit. */
export async function standDown(args: {
  escalationId: string;
  resolvedBy: string;
  resolutionNotes?: string | null;
}): Promise<CloseResult> {
  return closeEscalation("stood_down", "escalation.stood_down", args);
}

async function closeEscalation(
  newStatus: "resolved" | "stood_down",
  action: string,
  args: { escalationId: string; resolvedBy: string; resolutionNotes?: string | null; replacementPlacementId?: string | null },
): Promise<CloseResult> {
  const now = new Date();
  let changed = false;
  await withTx(async (tx) => {
    const updated = await tx
      .update(escalations)
      .set({
        status: newStatus,
        resolvedBy: args.resolvedBy,
        resolutionNotes: args.resolutionNotes ?? null,
        replacementPlacementId: args.replacementPlacementId ?? null,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(and(eq(escalations.id, args.escalationId), inArray(escalations.status, ["open", "in_progress"])))
      .returning({ id: escalations.id });
    if (updated.length === 0) return;
    changed = true;
    await recordAuditCore(
      {
        userId: args.resolvedBy,
        action,
        resource: "escalations",
        resourceId: args.escalationId,
        after: { notes: args.resolutionNotes ?? null, replacementPlacementId: args.replacementPlacementId ?? null },
      },
      tx,
    );
  });
  return changed ? { ok: true } : { ok: false, error: "wrong_status" };
}

/* ---- read-model for the P4b banner / AI (owner-scoped, no chef/klant PII) ---- */

export type EscalationView = {
  id: string;
  shiftId: string;
  kind: EmergencyKind;
  status: "open" | "in_progress";
  reason: string;
  createdAt: Date;
  shiftStartsAt: Date;
  roleNeeded: string;
  companyName: string | null;
};

export async function listOpenEscalations(): Promise<EscalationView[]> {
  const rows = await db
    .select({
      id: escalations.id,
      shiftId: escalations.shiftId,
      kind: escalations.kind,
      status: escalations.status,
      reason: escalations.reason,
      createdAt: escalations.createdAt,
      shiftStartsAt: shifts.startsAt,
      roleNeeded: shifts.roleNeeded,
      companyName: clients.companyName,
    })
    .from(escalations)
    .innerJoin(shifts, eq(shifts.id, escalations.shiftId))
    .leftJoin(clients, eq(clients.id, shifts.clientId))
    .where(inArray(escalations.status, ["open", "in_progress"]))
    .orderBy(desc(escalations.createdAt));
  return rows as EscalationView[];
}
