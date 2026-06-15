"use server";

/**
 * Dashboard drawer actions — the "fix in place" mutations fired from the @drawer
 * surfaces. Each reuses the SAME atomic domain function the shift-detail page and
 * the planner workbench use (audit lives inside those), then redirects back to the
 * dashboard with a ?done= flash so the card revalidates + collapses to "✓ gelogd".
 *
 * Mirrors the planner page's inline actions (proposeFromCockpit/confirmFromCockpit).
 */

import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/permissions";
import { proposePlacement } from "@/lib/domain/matching";
import { transitionPlacement } from "@/lib/domain/placement-transition";
import { approveHoursRow } from "@/lib/domain/hours";
import { db } from "@/lib/db/client";
import { contactLogs, dashboardSignalState } from "@/lib/db/schema";
import { recordAuditFromRequest } from "@/lib/audit";
import { userSignalKey } from "@/lib/domain/dashboard-signal-state";

/** Propose a chef for an open shift (outbound — chef gets the offer). */
export async function proposeFromDashboard(formData: FormData) {
  const session = await requirePermission("shifts", "write");
  const shiftId = String(formData.get("shiftId") ?? "").trim();
  const chefId = String(formData.get("chefId") ?? "").trim();
  // Clamp the score from untrusted form input — internal-only, but never store NaN/out-of-range.
  const rawScore = Number(formData.get("matchScore"));
  const matchScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : undefined;
  if (!shiftId || !chefId) throw new Error("shiftId/chefId ontbreekt");

  const res = await proposePlacement(shiftId, chefId, { proposedBy: session.user.id, matchScore });
  redirect(`/admin/business?done=${res.status === "already_proposed" ? "al-voorgesteld" : "voorstel"}`);
}

/** Confirm an accepted placement (financial — commits the chef + fires the klant cascade). */
export async function confirmFromDashboard(formData: FormData) {
  const session = await requirePermission("shifts", "write");
  const placementId = String(formData.get("placementId") ?? "").trim();
  if (!placementId) throw new Error("placementId ontbreekt");

  // House rule: only fire from EXACTLY 'accepted' — a stale/double click is a clean no-op.
  const res = await transitionPlacement({
    placementId,
    newStatus: "confirmed",
    actorUserId: session.user.id,
    expectedStatus: "accepted",
  });
  redirect(`/admin/business?done=${res.ok && res.changed ? "bevestigd" : "niet-bevestigd"}`);
}

/** Approve a client-signed hours row (financial — books the money, same cascade as the hours page). */
export async function approveHoursFromDashboard(formData: FormData) {
  const session = await requirePermission("hours", "approve");
  const hoursId = String(formData.get("hoursId") ?? "").trim();
  if (!hoursId) throw new Error("hoursId ontbreekt");

  const res = await approveHoursRow({ hoursId, approverUserId: session.user.id });
  redirect(`/admin/business?done=${res.ok ? "uren-goedgekeurd" : "uren-mislukt"}`);
}

/**
 * Snooze a dashboard signal — hide it from the rail for N hours (default 4). Time-based,
 * auto-reappears. PER-VIEWER (userId-prefixed key) so it never hides the signal for other
 * operators. Audited WITH the actor.
 */
export async function snoozeSignal(formData: FormData) {
  const session = await requirePermission("cockpit", "read");
  const rawKey = String(formData.get("signalKey") ?? "").trim();
  const hours = Number(formData.get("hours") ?? 4) || 4;
  if (!rawKey) throw new Error("signalKey ontbreekt");

  const key = userSignalKey(session.user.id, rawKey);
  const snoozeUntil = new Date(Date.now() + hours * 3_600_000);
  const now = new Date();
  await db
    .insert(dashboardSignalState)
    .values({ signalKey: key, snoozeUntil, dismissedReason: null, fingerprint: null, updatedBy: session.user.id, updatedAt: now })
    .onConflictDoUpdate({
      target: dashboardSignalState.signalKey,
      set: { snoozeUntil, dismissedReason: null, fingerprint: null, updatedBy: session.user.id, updatedAt: now },
    });
  await recordAuditFromRequest({ userId: session.user.id, action: "dashboard.signal.snooze", resource: "dashboard", resourceId: rawKey, after: { hours } }).catch(() => {});
  redirect("/admin/business?done=snoozed");
}

/**
 * Dismiss a signal with a required reason ("Klaar — bevestigd via telefoon"). PER-VIEWER.
 * Hides it until the underlying state changes (fingerprint differs). Reason + actor audited.
 */
export async function dismissSignal(formData: FormData) {
  const session = await requirePermission("cockpit", "read");
  const rawKey = String(formData.get("signalKey") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const fingerprint = String(formData.get("fingerprint") ?? "");
  // return so a future non-throwing redirect can't fall through to an empty-reason write.
  if (!rawKey || !reason) return redirect("/admin/business?done=reden-vereist");

  const key = userSignalKey(session.user.id, rawKey);
  const now = new Date();
  await db
    .insert(dashboardSignalState)
    .values({ signalKey: key, dismissedReason: reason, fingerprint, snoozeUntil: null, updatedBy: session.user.id, updatedAt: now })
    .onConflictDoUpdate({
      target: dashboardSignalState.signalKey,
      set: { dismissedReason: reason, fingerprint, snoozeUntil: null, updatedBy: session.user.id, updatedAt: now },
    });
  await recordAuditFromRequest({ userId: session.user.id, action: "dashboard.signal.dismiss", resource: "dashboard", resourceId: rawKey, after: { reason } }).catch(() => {});
  redirect("/admin/business?done=opgelost");
}

/**
 * Log a contact attempt with a chef from the fill drawer (call/app/note + outcome). Writes
 * a contactLogs row tied to the shift — feeds the per-shift timeline and (later) matching.
 * Mirrors the shift-detail page's logContact action.
 */
export async function logChefContactFromDashboard(formData: FormData) {
  const session = await requirePermission("shifts", "write");
  const chefId = String(formData.get("chefId") ?? "").trim();
  const shiftId = String(formData.get("shiftId") ?? "").trim();
  if (!chefId || !shiftId) throw new Error("chefId/shiftId ontbreekt");
  const outcome = String(formData.get("outcome") ?? "note_only");
  const channel = String(formData.get("channel") ?? "phone");
  const note = String(formData.get("note") ?? "").trim() || null;

  await db.insert(contactLogs).values({
    actorUserId: session.user.id,
    targetType: "chef",
    targetId: chefId,
    channel,
    entityType: "shift",
    entityId: shiftId,
    outcome,
    note,
  });
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "contact_logs.created",
    resource: "contact_logs",
    resourceId: chefId,
    after: { shiftId, outcome, channel },
  }).catch(() => {});
  redirect(`/admin/business?drawer=open-shift&shiftId=${shiftId}&done=contact-gelogd`);
}
