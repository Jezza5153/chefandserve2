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
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { agendaEvents, users } from "@/lib/db/schema";
import { addDaysToKey, amsterdamDayKey, amsterdamMidnightUtc } from "@/lib/roster-format";
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
  /** The klant user who rated — provenance only; NEVER used as creator/assignee. */
  createdBy: string;
}): Promise<void> {
  // Dark-launch rule (CLAUDE.md): a new side-effect surface ships behind a default-off
  // flag with idempotency, so re-fires are harmless.
  if (process.env.RATING_FOLLOWUP_ENABLED !== "true") return;

  // The follow-up is an OWNER work item. If the owner cannot be resolved we skip and
  // log — an internal agenda row must NEVER be created/assigned under the klant's user
  // (it would leak the internal follow-through into their audit trail).
  const ownerEmail = env.MAARTEN_EMAIL?.trim().toLowerCase();
  const [owner] = ownerEmail
    ? await db.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail)).limit(1)
    : [];
  if (!owner?.id) {
    console.error("[rating-follow-up] owner not resolvable (MAARTEN_EMAIL) — follow-up skipped");
    return;
  }

  // Idempotent per shift: one open follow-up, however many low ratings arrive.
  const [existing] = await db
    .select({ id: agendaEvents.id })
    .from(agendaEvents)
    .where(
      and(
        eq(agendaEvents.type, "follow_up"),
        eq(agendaEvents.status, "open"),
        eq(agendaEvents.linkedShiftId, args.shiftId),
      ),
    )
    .limit(1);
  if (existing) return;

  // Tomorrow 09:00 Amsterdam, DST-correct.
  const startsAt = new Date(
    amsterdamMidnightUtc(addDaysToKey(amsterdamDayKey(new Date()), 1)).getTime() + 9 * 3600e3,
  );

  const row = await createAgendaEvent({
    type: "follow_up",
    startsAt,
    title: `Nabellen: ${args.companyName ?? "klant"} gaf ${args.stars}★${args.chefName ? ` over ${args.chefName}` : ""}`,
    notes: "Automatisch aangemaakt na een lage beoordeling. Details: feedback-overzicht (intern).",
    linkedClientId: args.clientId,
    linkedChefId: args.chefId,
    linkedShiftId: args.shiftId,
    assignedTo: owner.id,
    createdBy: owner.id,
  });

  {
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
