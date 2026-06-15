/**
 * CHEF-PR4 — clock-out review. The 6 short post-shift questions feed the
 * planned-vs-actual + hotel-overpromise reports (PR-10) and protect both chef and
 * Maarten. Ownership IS the lookup. The chef's free issue note is DATA, not
 * instructions (display only, capped). On any client-issue flag the owner gets an
 * attention notification.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, placements, shiftHourReviews, shifts, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createNotification } from "@/lib/integrations";
import { amsterdamDayKey } from "@/lib/roster-format";

export type ClockOutAnswers = {
  workedPlannedRole: boolean | null;
  workedExtraHours: boolean | null;
  gotBreak: boolean | null;
  asDescribed: boolean | null;
  issueNote: string | null;
  wouldReturn: boolean | null;
};

export async function submitClockOutReview(args: {
  chefId: string;
  placementId: string;
  answers: ClockOutAnswers;
}): Promise<{ ok: boolean }> {
  // Ownership: the chef must own this placement (auth IS the lookup).
  const placement = await db.query.placements.findFirst({
    where: and(eq(placements.id, args.placementId), eq(placements.chefId, args.chefId)),
  });
  if (!placement) return { ok: false };

  const a = args.answers;
  const issueNote = (a.issueNote ?? "").trim().slice(0, 1000) || null;

  await db
    .insert(shiftHourReviews)
    .values({
      placementId: args.placementId,
      chefId: args.chefId,
      workedPlannedRole: a.workedPlannedRole,
      workedExtraHours: a.workedExtraHours,
      gotBreak: a.gotBreak,
      asDescribed: a.asDescribed,
      issueNote,
      wouldReturn: a.wouldReturn,
    })
    .onConflictDoNothing({ target: shiftHourReviews.placementId });

  // Reflect would-return into the existing post-shift signal too.
  if (a.wouldReturn != null) {
    await db
      .update(placements)
      .set({ chefReturnSignal: a.wouldReturn })
      .where(eq(placements.id, args.placementId))
      .catch(() => {});
  }

  // Owner attention if anything points at a client issue.
  const flagged =
    a.asDescribed === false || a.gotBreak === false || a.workedExtraHours === true || !!issueNote;
  if (flagged) {
    await notifyOwnerOfReviewIssue(placement.shiftId, placement.chefId, a, issueNote).catch((e) =>
      console.error("[clock-out-review] owner notify failed:", e),
    );
  }
  return { ok: true };
}

async function notifyOwnerOfReviewIssue(
  shiftId: string,
  chefId: string,
  a: ClockOutAnswers,
  issueNote: string | null,
): Promise<void> {
  if (!env.MAARTEN_EMAIL) return;
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, env.MAARTEN_EMAIL))
    .limit(1);
  if (!owner) return;
  const shift = await db.query.shifts.findFirst({ where: eq(shifts.id, shiftId) });
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, chefId) });
  const client = shift ? await db.query.clients.findFirst({ where: eq(clients.id, shift.clientId) }) : null;
  const flags = [
    a.asDescribed === false ? "shift week af van de brief" : null,
    a.gotBreak === false ? "geen pauze" : null,
    a.workedExtraHours === true ? "extra uren gewerkt" : null,
    issueNote ? `opmerking: "${issueNote}"` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  await createNotification({
    userId: owner.id,
    type: "clockout_issue",
    title: `Aandachtspunt na shift — ${chef?.fullName ?? "een chef"} bij ${client?.companyName ?? "een klant"}`,
    body: `${shift ? amsterdamDayKey(shift.startsAt) : ""}: ${flags}`,
    actionUrl: shift ? `/admin/business/shifts/${shift.id}` : "/admin/business",
    entityType: "placements",
    entityId: shift ? shift.id : chefId,
  });
}
