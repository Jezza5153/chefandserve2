/**
 * Worker/route-safe placement status transition — used by the AI tools
 * (placements.confirm / placements.cancel).
 *
 * It mirrors the admin shift page's inline `setPlacementStatus` core: an atomic
 * status transition with the terminal guard (never resurrect completed/cancelled),
 * the shift-status recompute in the same tx, and the audit row; plus the same
 * confirm-email cascade the page sends when a placement reaches "confirmed".
 *
 * DRY-debt (intentional): the admin page keeps its own inline copy for now. This
 * file is a faithful, independently-callable duplicate so the AI path never touches
 * the live human flow. Unify them in a follow-up once we can test the page rewire.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { withTx } from "@/lib/db/tx";
import { recordAuditCore } from "@/lib/audit";
import { chefs, clients, placements, shifts } from "@/lib/db/schema";
import { recomputeShiftStatus } from "@/lib/domain/shift-status";
import { recipientsForClient } from "@/lib/domain/client-recipients";
import { sendReplacementHandover } from "@/lib/domain/replacement-handover";
import { sendEmail, formatShiftWhen } from "@/lib/email";
import { env } from "@/lib/env";
import { createNotification, recordEmailMessage } from "@/lib/integrations";
import { ShiftConfirmedClientEmail } from "@/emails/ShiftConfirmedClientEmail";
import { ShiftConfirmedChefEmail } from "@/emails/ShiftConfirmedChefEmail";

type TransitionStatus = "accepted" | "confirmed" | "rejected" | "cancelled";

export type TransitionResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: string };

export async function transitionPlacement(args: {
  placementId: string;
  newStatus: TransitionStatus;
  actorUserId: string;
  /** House rule "UPDATE … WHERE status='<expected>'": when set, the transition only fires from
   *  EXACTLY this status — a stale/double click (or an already-confirmed row) becomes a clean
   *  changed:false instead of re-firing the notify/email cascade. Optional for back-compat. */
  expectedStatus?: "proposed" | "accepted" | "confirmed";
}): Promise<TransitionResult> {
  const now = new Date();
  let changed = false;
  let priorStatus: string | null = null;

  await withTx(async (tx) => {
    // Capture the prior status in-tx (for the replacement-handover decision).
    const [before] = await tx
      .select({ status: placements.status })
      .from(placements)
      .where(eq(placements.id, args.placementId))
      .limit(1);
    priorStatus = before?.status ?? null;

    const updated = await tx
      .update(placements)
      .set({
        status: args.newStatus,
        respondedAt: ["accepted", "rejected"].includes(args.newStatus) ? now : undefined,
        confirmedAt: args.newStatus === "confirmed" ? now : undefined,
        cancelledAt: args.newStatus === "cancelled" ? now : undefined,
        updatedAt: now,
      })
      .where(
        and(
          eq(placements.id, args.placementId),
          sql`${placements.status} NOT IN ('completed', 'cancelled')`,
          ...(args.expectedStatus ? [eq(placements.status, args.expectedStatus)] : []),
        ),
      )
      .returning({ id: placements.id, shiftId: placements.shiftId });
    if (updated.length === 0) return; // terminal/stale — no-op
    changed = true;
    await recordAuditCore(
      {
        userId: args.actorUserId,
        action: `placements.${args.newStatus}`,
        resource: "placements",
        resourceId: args.placementId,
      },
      tx,
    );
    await recomputeShiftStatus(updated[0]!.shiftId, tx);
  });

  if (!changed) return { ok: true, changed: false };

  if (args.newStatus === "confirmed") {
    await sendPlacementConfirmedEmails(args.placementId).catch((e) => {
      console.error("[transitionPlacement] confirm emails failed:", e);
    });
  }

  // CHEF-PR2 (R2#13): a committed chef (accepted/confirmed) just got pulled off →
  // tell them not to show up + stop arrival monitoring. Dark-launched + idempotent;
  // best-effort, never throws into the transition.
  if (args.newStatus === "cancelled") {
    await sendReplacementHandover({ placementId: args.placementId, priorStatus }).catch((e) => {
      console.error("[transitionPlacement] replacement handover failed:", e);
    });
  }
  return { ok: true, changed: true };
}

/** The "placement confirmed" cascade: klant email + chef email + chef in-app note.
 *  Best-effort (post-commit); mirrors the admin shift page exactly. */
export async function sendPlacementConfirmedEmails(placementId: string): Promise<void> {
  const placement = await db.query.placements.findFirst({ where: eq(placements.id, placementId) });
  if (!placement) return;
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, placement.chefId) });
  const shift = await db.query.shifts.findFirst({ where: eq(shifts.id, placement.shiftId) });
  const clientRow = shift ? await db.query.clients.findFirst({ where: eq(clients.id, shift.clientId) }) : null;
  if (!chef || !shift) return;
  const shiftWhen = formatShiftWhen(shift.startsAt, shift.endsAt);

  if (clientRow) {
    const klantTo = await recipientsForClient(clientRow.id, "shift_confirmed");
    if (klantTo.length > 0) {
      const send = await sendEmail({
        to: klantTo,
        subject: `Chef bevestigd voor ${clientRow.companyName} — ${shift.roleNeeded}`,
        react: ShiftConfirmedClientEmail({
          clientContactName: clientRow.contactName,
          companyName: clientRow.companyName,
          chefName: chef.fullName,
          chefVakniveau: chef.vakniveau,
          chefYears: chef.yearsExperience,
          shiftWhen,
          shiftLocation: shift.location ?? shift.city,
          shiftRole: shift.roleNeeded,
          hubUrl: `${env.NEXT_PUBLIC_APP_URL}/client/shifts/${shift.id}`,
        }),
      });
      if (send.ok) {
        for (const to of klantTo) {
          await recordEmailMessage({
            providerMessageId: send.id,
            toEmail: to,
            template: "ShiftConfirmedClientEmail",
            eventKey: "shift_confirmed",
            entityType: "placement",
            entityId: placementId,
            userId: clientRow.userId ?? undefined,
          });
        }
      }
    }
    // Klant in-app note — every user-visible event → createNotification(). The chef
    // gets one below; the klant must too (this was missing). Always fires (the bell
    // is the inline floor); the email above respects the klant's opt-out.
    if (clientRow.userId) {
      await createNotification({
        userId: clientRow.userId,
        type: "shift_confirmed",
        title: `Chef bevestigd voor ${shift.roleNeeded}`,
        body: `${chef.fullName} is bevestigd voor je shift.`,
        actionUrl: `/client/shifts/${shift.id}`,
        entityType: "placement",
        entityId: placementId,
      });
    }
  }

  if (chef.email) {
    const send = await sendEmail({
      to: chef.email,
      subject: `Shift bevestigd: ${shift.roleNeeded} bij ${clientRow?.companyName ?? "klant"}`,
      react: ShiftConfirmedChefEmail({
        chefName: chef.fullName,
        clientName: clientRow?.companyName ?? "—",
        shiftWhen,
        shiftLocation: shift.location ?? shift.city,
        shiftRole: shift.roleNeeded,
        clientContactName: clientRow?.contactName,
        clientContactPhone: clientRow?.phone,
        placementUrl: `${env.NEXT_PUBLIC_APP_URL}/chef/shifts/${placementId}`,
      }),
    });
    if (send.ok) {
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: chef.email,
        template: "ShiftConfirmedChefEmail",
        eventKey: "shift_confirmed",
        entityType: "placement",
        entityId: placementId,
        userId: chef.userId ?? undefined,
      });
    }
  }

  if (chef.userId) {
    await createNotification({
      userId: chef.userId,
      type: "shift_confirmed",
      title: `Shift bevestigd bij ${clientRow?.companyName ?? "klant"}`,
      body: shiftWhen,
      actionUrl: `/chef/shifts/${placementId}`,
      entityType: "placement",
      entityId: placementId,
    });
  }
}
