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
