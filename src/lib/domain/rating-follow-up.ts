/**
 * Low-rating follow-up (RATING-LOOP) — a ≤3★ rating is a relationship signal, not a
 * data point. It must land on the OWNER's agenda the same morning, not sit unread in
 * a ratings table.
 *
 * Creates a follow_up agenda event (dashboard Vandaag-strip + agenda.vandaag +
 * planning + calendar feed) assigned to the owner, plus an in-app notification.
 * INTERNAL ONLY: the klant never sees any of this (ratings internal-only V1), and
 * the event carries labels — never the klant's free-text comment (that stays in the
 * ratings table where feedback.review reads it).
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createAgendaEvent } from "@/lib/domain/agenda-events";
import { createNotification } from "@/lib/integrations";

export async function createLowRatingFollowUp(args: {
  clientId: string;
  companyName: string | null;
  chefId: string | null;
  chefName: string | null;
  shiftId: string;
  stars: number;
  /** The klant user who rated — used only as createdBy provenance. */
  createdBy: string;
}): Promise<void> {
  // Assign to the owner when resolvable; otherwise the event still lands (assignedTo
  // falls back to createdBy inside createAgendaEvent) and the notification is skipped.
  const ownerEmail = env.MAARTEN_EMAIL?.trim().toLowerCase();
  const [owner] = ownerEmail
    ? await db.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail)).limit(1)
    : [];

  // Tomorrow 09:00 Amsterdam-ish: today's UTC midnight + 33h is close enough for an
  // internal follow-up and keeps this file free of tz imports the worker also lacks.
  const startsAt = new Date();
  startsAt.setUTCHours(0, 0, 0, 0);
  startsAt.setUTCHours(33);

  const row = await createAgendaEvent({
    type: "follow_up",
    startsAt,
    title: `Nabellen: ${args.companyName ?? "klant"} gaf ${args.stars}★${args.chefName ? ` over ${args.chefName}` : ""}`,
    notes: "Automatisch aangemaakt na een lage beoordeling. Details: feedback-overzicht (intern).",
    linkedClientId: args.clientId,
    linkedChefId: args.chefId,
    linkedShiftId: args.shiftId,
    assignedTo: owner?.id ?? null,
    createdBy: owner?.id ?? args.createdBy,
  });

  if (owner?.id) {
    await createNotification({
      userId: owner.id,
      type: "rating_follow_up",
      title: `${args.companyName ?? "Een klant"} gaf ${args.stars}★ — even nabellen`,
      body: args.chefName ? `Over ${args.chefName}. Staat op je agenda voor morgenochtend.` : "Staat op je agenda voor morgenochtend.",
      actionUrl: `/admin/business/shifts/${args.shiftId}`,
    }).catch(() => {});
  }
  void row;
}
