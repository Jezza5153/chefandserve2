/**
 * Admin hours operations — makes the hours→payroll value chain fully operable
 * by hand, not only via the `complete-placements` cron.
 *
 * Real-operation gaps this closes:
 *   - completePlacement: start the hours loop ON DEMAND (admin marks a confirmed
 *     placement done now, instead of waiting ≤30 min for the cron). Mirrors
 *     `workers/complete-placements.ts` for a single placement; idempotent.
 *   - adminEditHours: correct the actual started/ended/break/rates on a row that
 *     isn't exported/void (chef worked different hours, a typo, a correction).
 *   - voidHours: a no-show / cancelled-after-completion row → 'void'.
 *
 * Finalize/override-approve reuses `approveHoursRow` (hours.ts) with a widened
 * `fromStatuses` set, so the admin can approve a row that never went through
 * chef-submit + client-sign (e.g. the chef won't act and the admin enters the
 * hours on their behalf). All side-effects (payroll outbox + notify + email)
 * stay identical to the normal approve path.
 *
 * Every write here is atomic (withTx) + audited. Auth is the CALLER's job
 * (these helpers don't check roles) — mirrors hours.ts.
 *
 * ⚠️ Keep `completePlacement`'s draft-row shape in sync with
 * `workers/complete-placements.ts` (the worker can't import this module — it
 * runs standalone on Railway off raw env, not src/lib/env).
 */

import { and, eq, notInArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAuditCore, stampFromRequest } from "@/lib/audit";
import { withTx } from "@/lib/db/tx";
import { placements, shiftHours, shifts } from "@/lib/db/schema";

/** Worked minutes = ended − started − break, floored at 0. */
function computeWorkedMinutes(startedAt: Date, endedAt: Date, breakMinutes: number): number {
  return Math.max(
    0,
    Math.floor((endedAt.getTime() - startedAt.getTime()) / 60000) - Math.max(0, breakMinutes),
  );
}

/**
 * Force-complete a CONFIRMED placement (on demand) and mint its draft
 * shift_hours row — exactly what the cron does, but for one placement now.
 * Idempotent: the shift_hours.placementId UNIQUE constraint means re-running
 * never duplicates. Returns the hours row id (new or pre-existing).
 */
export async function completePlacement(args: {
  placementId: string;
  actorUserId: string;
}): Promise<
  | { ok: true; hoursId: string | null }
  | { ok: false; reason: "not-confirmed" | "no-client" | "not-ended" }
> {
  // ----- Guard: the shift must have actually ENDED -----
  // Mirror the complete-placements worker's `ends_at < now() - 1h` invariant so we never
  // book a draft urenregel for unworked/future time (defends the admin button AND the AI tool).
  const [pre] = await db
    .select({ endsAt: shifts.endsAt })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .where(eq(placements.id, args.placementId))
    .limit(1);
  if (pre?.endsAt && pre.endsAt.getTime() > Date.now() - 3_600_000) {
    return { ok: false, reason: "not-ended" };
  }

  // ----- Step 1: confirmed → completed (atomic + audited) -----
  const completeAudit = await stampFromRequest({
    userId: args.actorUserId,
    action: "placement.completed",
    resource: "placement",
    resourceId: args.placementId,
    after: { via: "admin" },
  });
  const flipped = await withTx(async (tx) => {
    const u = await tx
      .update(placements)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(placements.id, args.placementId), eq(placements.status, "confirmed")))
      .returning({
        id: placements.id,
        shiftId: placements.shiftId,
        chefId: placements.chefId,
        chefRateCents: placements.chefRateCents,
      });
    if (u.length === 0) return u;
    await recordAuditCore(completeAudit, tx);
    return u;
  });

  if (flipped.length === 0) return { ok: false, reason: "not-confirmed" };
  const p = flipped[0];

  // ----- Step 2: insert the draft hours row (mirror the worker) -----
  const [s] = await db
    .select({
      clientId: shifts.clientId,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      chefRate: shifts.chefRateCents,
      clientRate: shifts.clientRateCents,
    })
    .from(shifts)
    .where(eq(shifts.id, p.shiftId))
    .limit(1);

  if (!s || !s.clientId) {
    // Placement is completed, but with no client/schedule we can't seed hours.
    return { ok: false, reason: "no-client" };
  }

  const chefRate = p.chefRateCents ?? s.chefRate ?? 0;
  const clientRate = s.clientRate ?? 0;
  const scheduledMinutes = Math.max(
    0,
    Math.floor((new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 60000),
  );

  const inserted = await db
    .insert(shiftHours)
    .values({
      placementId: p.id,
      shiftId: p.shiftId,
      chefId: p.chefId,
      clientId: s.clientId,
      startedAt: s.startsAt,
      endedAt: s.endsAt,
      breakMinutes: 0,
      workedMinutes: scheduledMinutes,
      chefRateCents: chefRate,
      clientRateCents: clientRate,
      status: "draft",
    })
    .onConflictDoNothing({ target: shiftHours.placementId })
    .returning({ id: shiftHours.id });

  if (inserted.length > 0) {
    await recordAuditCore(
      await stampFromRequest({
        userId: args.actorUserId,
        action: "shift_hours.draft_created",
        resource: "shift_hours",
        resourceId: inserted[0].id,
        after: { placementId: p.id, via: "admin" },
      }),
    );
    return { ok: true, hoursId: inserted[0].id };
  }

  // Row already existed (cron beat us, or double click) — return it.
  const [existing] = await db
    .select({ id: shiftHours.id })
    .from(shiftHours)
    .where(eq(shiftHours.placementId, p.id))
    .limit(1);
  return { ok: true, hoursId: existing?.id ?? null };
}

/**
 * Correct the actual numbers on a hours row (admin). Recomputes workedMinutes.
 * Editable ONLY while the row is still mutable in place — i.e. NOT
 * 'admin_approved', 'exported' or 'void'. Once a row is admin-approved the
 * schema treats it as READ-ONLY (it has, or is about to, become a payroll
 * obligation): post-approval changes must go through a `shift_hour_corrections`
 * row, not an in-place mutation. That corrections subsystem is future work
 * (PR-CHEF-7) — until it exists, an admin who needs to change approved hours
 * must reject the row back first. Audits before→after.
 */
export async function adminEditHours(args: {
  hoursId: string;
  actorUserId: string;
  startedAt: Date;
  endedAt: Date;
  breakMinutes: number;
  chefRateCents?: number;
  clientRateCents?: number;
  adminNotes?: string | null;
}): Promise<{ ok: true } | { ok: false; reason: "end-before-start" | "stale-or-locked" }> {
  if (args.endedAt.getTime() <= args.startedAt.getTime()) {
    return { ok: false, reason: "end-before-start" };
  }
  const workedMinutes = computeWorkedMinutes(args.startedAt, args.endedAt, args.breakMinutes);

  // Capture the prior values for the audit trail.
  const [before] = await db
    .select({
      startedAt: shiftHours.startedAt,
      endedAt: shiftHours.endedAt,
      breakMinutes: shiftHours.breakMinutes,
      workedMinutes: shiftHours.workedMinutes,
      chefRateCents: shiftHours.chefRateCents,
      clientRateCents: shiftHours.clientRateCents,
    })
    .from(shiftHours)
    .where(eq(shiftHours.id, args.hoursId))
    .limit(1);

  const auditBase = await stampFromRequest({
    userId: args.actorUserId,
    action: "shift_hours.admin_edited",
    resource: "shift_hours",
    resourceId: args.hoursId,
    before: before ?? undefined,
    after: {
      startedAt: args.startedAt,
      endedAt: args.endedAt,
      breakMinutes: Math.max(0, args.breakMinutes),
      workedMinutes,
      ...(args.chefRateCents != null ? { chefRateCents: args.chefRateCents } : {}),
      ...(args.clientRateCents != null ? { clientRateCents: args.clientRateCents } : {}),
    },
  });

  const updated = await withTx(async (tx) => {
    const u = await tx
      .update(shiftHours)
      .set({
        startedAt: args.startedAt,
        endedAt: args.endedAt,
        breakMinutes: Math.max(0, args.breakMinutes),
        workedMinutes,
        ...(args.chefRateCents != null ? { chefRateCents: args.chefRateCents } : {}),
        ...(args.clientRateCents != null ? { clientRateCents: args.clientRateCents } : {}),
        ...(args.adminNotes !== undefined ? { adminNotes: args.adminNotes } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(shiftHours.id, args.hoursId),
          // admin_approved is READ-ONLY in place — post-approval edits need the
          // future shift_hour_corrections subsystem (see docstring).
          notInArray(shiftHours.status, ["exported", "void", "admin_approved"]),
        ),
      )
      .returning({ id: shiftHours.id });
    if (u.length === 0) return u;
    await recordAuditCore(auditBase, tx);
    return u;
  });

  if (updated.length === 0) return { ok: false, reason: "stale-or-locked" };
  return { ok: true };
}

/**
 * Void a hours row (no-show / cancelled after completion). Refuses 'exported'.
 * Audits the reason.
 */
export async function voidHours(args: {
  hoursId: string;
  actorUserId: string;
  reason: string;
}): Promise<{ ok: true } | { ok: false; reason: "reason-too-short" | "stale-or-exported" }> {
  const reason = args.reason.trim();
  if (reason.length < 3) return { ok: false, reason: "reason-too-short" };

  const auditBase = await stampFromRequest({
    userId: args.actorUserId,
    action: "shift_hours.voided",
    resource: "shift_hours",
    resourceId: args.hoursId,
    after: { reason },
  });

  const updated = await withTx(async (tx) => {
    const u = await tx
      .update(shiftHours)
      .set({ status: "void", adminNotes: reason, updatedAt: new Date() })
      .where(
        and(eq(shiftHours.id, args.hoursId), notInArray(shiftHours.status, ["exported"])),
      )
      .returning({ id: shiftHours.id });
    if (u.length === 0) return u;
    await recordAuditCore(auditBase, tx);
    return u;
  });

  if (updated.length === 0) return { ok: false, reason: "stale-or-exported" };
  return { ok: true };
}
