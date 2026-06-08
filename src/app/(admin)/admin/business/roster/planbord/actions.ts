"use server";

/**
 * Planbord server actions — the only write surface the drag-drop board calls.
 * Each gates on requirePermission("shifts", "write") (same right the shift page
 * + the AI placement tools use) and resolves the actor from the session, never
 * from client input. Drafting + removing are silent (no chef/klant contact);
 * publishing is the single moment everyone is notified.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db/client";
import { shifts } from "@/lib/db/schema";
import { draftPlacement, findMatchesForShift } from "@/lib/domain/matching";
import { estimateMargin, estimateTravel } from "@/lib/domain/travel";
import { autofillWeek, copyLastWeek, type AutofillResult, type CopyResult } from "@/lib/domain/roster-autofill";
import {
  clearDraftsForPeriod,
  confirmAcceptedForPeriod,
  publishDraftsForPeriod,
  removeDraftPlacement,
  type ConfirmResult,
  type PublishResult,
} from "@/lib/domain/roster-publish";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { getAmsterdamWeekRange } from "@/lib/roster-format";

const PLANBORD_PATH = "/admin/business/roster/planbord";

/** Drop a chef onto a slot → a private concept. No chef/klant contact yet. */
export async function draftChefAction(input: {
  shiftId: string;
  chefId: string;
  matchScore?: number;
}): Promise<{ ok: boolean; status: "draft" | "already_active" }> {
  const session = await requirePermission("shifts", "write");
  const res = await draftPlacement(input.shiftId, input.chefId, {
    proposedBy: session.user.id,
    ...(input.matchScore != null ? { matchScore: input.matchScore } : {}),
  });
  revalidatePath(PLANBORD_PATH);
  return { ok: res.status === "draft", status: res.status };
}

/** Pull a concept back off the board. Atomic — can never touch a published row. */
export async function removeDraftAction(placementId: string): Promise<{ removed: boolean }> {
  await requirePermission("shifts", "write");
  const res = await removeDraftPlacement(placementId);
  revalidatePath(PLANBORD_PATH);
  return res;
}

/** Publiceer — commit the week's concepts → proposed. THIS is when everyone hears. */
export async function publishWeekAction(anchorDateKey: string): Promise<PublishResult> {
  const session = await requirePermission("shifts", "write");
  const week = getAmsterdamWeekRange(anchorDateKey);
  const res = await publishDraftsForPeriod({
    startUtc: week.startUtc,
    endUtc: week.endUtc,
    actorUserId: session.user.id,
  });
  revalidatePath(PLANBORD_PATH);
  return res;
}

/** Ranked candidates for ONE shift — feeds the planbord focus rail (score + the "why"). */
export async function matchesForShiftAction(shiftId: string): Promise<
  Array<{
    chefId: string;
    fullName: string;
    score: number;
    reason: string | null;
    warning: string | null;
    travelKm: number | null;
    marginCents: number | null;
    marginTone: "ok" | "low" | "negative" | null;
  }>
> {
  const session = await requirePermission("shifts", "write");
  // Margin reveals rates → owner-only (payroll.read). Planners see score + travel.
  const canSeeMargin = await hasPermission(session, "payroll", "read");
  const shift = await db.query.shifts.findFirst({ where: eq(shifts.id, shiftId) });
  const to =
    shift?.latitude != null && shift?.longitude != null
      ? { lat: Number(shift.latitude), lng: Number(shift.longitude) }
      : null;
  const hours = shift
    ? (new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime()) / 3_600_000
    : 0;
  const matches = await findMatchesForShift(shiftId, { limit: 8 });
  return matches.map((m) => {
    const from =
      m.chef.latitude != null && m.chef.longitude != null
        ? { lat: Number(m.chef.latitude), lng: Number(m.chef.longitude) }
        : null;
    const travel = to && from ? estimateTravel({ from, to, mode: m.chef.transportMode }) : null;
    let marginCents: number | null = null;
    let marginTone: "ok" | "low" | "negative" | null = null;
    if (canSeeMargin && shift) {
      const mg = estimateMargin({
        clientRateCents: shift.clientRateCents,
        chefRateCents: m.chef.hourlyRateMinCents ?? shift.chefRateCents,
        hours,
        travelCents: travel?.costCents ?? 0,
      });
      marginCents = mg.marginCents;
      marginTone = mg.tone;
    }
    return {
      chefId: m.chef.id,
      fullName: m.chef.fullName,
      score: m.score,
      reason: m.reasons[0] ?? null,
      warning: m.warnings[0] ?? null,
      travelKm: travel?.km ?? null,
      marginCents,
      marginTone,
    };
  });
}

/** "Wis concepten" — remove all the week's draft placements (redo after an autofill). */
export async function clearDraftsAction(anchorDateKey: string): Promise<{ removed: number }> {
  await requirePermission("shifts", "write");
  const week = getAmsterdamWeekRange(anchorDateKey);
  const res = await clearDraftsForPeriod({ startUtc: week.startUtc, endUtc: week.endUtc });
  revalidatePath(PLANBORD_PATH);
  return res;
}

/** "Vul de week" — auto-draft the best available chef onto every open slot. */
export async function autofillWeekAction(anchorDateKey: string): Promise<AutofillResult> {
  const session = await requirePermission("shifts", "write");
  const week = getAmsterdamWeekRange(anchorDateKey);
  const res = await autofillWeek({
    startUtc: week.startUtc,
    endUtc: week.endUtc,
    actorUserId: session.user.id,
  });
  revalidatePath(PLANBORD_PATH);
  return res;
}

/** "Kopieer vorige week" — seed open slots from last week's same klant/weekday/role chefs. */
export async function copyLastWeekAction(anchorDateKey: string): Promise<CopyResult> {
  const session = await requirePermission("shifts", "write");
  const week = getAmsterdamWeekRange(anchorDateKey);
  const res = await copyLastWeek({
    startUtc: week.startUtc,
    endUtc: week.endUtc,
    actorUserId: session.user.id,
  });
  revalidatePath(PLANBORD_PATH);
  return res;
}

/** "Bevestig geaccepteerde" — confirm every accepted placement this week at once. */
export async function confirmWeekAction(anchorDateKey: string): Promise<ConfirmResult> {
  const session = await requirePermission("shifts", "write");
  const week = getAmsterdamWeekRange(anchorDateKey);
  const res = await confirmAcceptedForPeriod({
    startUtc: week.startUtc,
    endUtc: week.endUtc,
    actorUserId: session.user.id,
  });
  revalidatePath(PLANBORD_PATH);
  return res;
}
