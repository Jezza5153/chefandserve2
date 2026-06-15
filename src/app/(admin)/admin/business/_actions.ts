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

/** Propose a chef for an open shift (outbound — chef gets the offer). */
export async function proposeFromDashboard(formData: FormData) {
  const session = await requirePermission("shifts", "write");
  const shiftId = String(formData.get("shiftId") ?? "").trim();
  const chefId = String(formData.get("chefId") ?? "").trim();
  const matchScore = formData.get("matchScore") ? Number(formData.get("matchScore")) : undefined;
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
