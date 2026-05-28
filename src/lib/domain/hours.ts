/**
 * Hours domain helpers — PR-CHEF-1 + PR-CHEF-3 + PR-CHEF-7 (corrections).
 *
 * Centralizes the state-machine writes + email cascade so chef portal,
 * klant portal, admin detail, and admin bulk-approve all share the same
 * trust chain semantics. Every transition still does the same five things:
 *
 *   1. Atomic UPDATE shift_hours WHERE status='<expected>'
 *   2. Insert audit_log row
 *   3. Enqueue integration_outbox event
 *   4. Create in-app notification(s)
 *   5. Send email(s) + recordEmailMessage
 *
 * Auth is the CALLER's responsibility — these helpers do not check roles.
 */

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import {
  chefs,
  clients,
  shiftHours,
  shifts,
} from "@/lib/db/schema";
import { recipientsForClient } from "@/lib/domain/client-recipients";
import { sendEmail } from "@/lib/email";
import {
  computeChefAmountCents,
  formatEuro,
  formatWorkedMinutes,
} from "@/lib/hours-labels";
import {
  createNotification,
  enqueueIntegrationEvent,
  recordEmailMessage,
} from "@/lib/integrations";

import { HoursApprovedChefEmail } from "@/emails/HoursApprovedChefEmail";
import { HoursApprovedKlantEmail } from "@/emails/HoursApprovedKlantEmail";
import { HoursRejectedByAdminEmail } from "@/emails/HoursRejectedByAdminEmail";
import { RatingPendingKlantEmail } from "@/emails/RatingPendingKlantEmail";

/**
 * Bulk-approve eligibility rules.
 *
 * Returns true when a `client_signed` row is safe to one-click approve:
 *   - worked time is within scheduled ±30 min
 *   - no chef or klant notes (anything weird → manual review)
 *   - both rates are set
 *
 * These rules are deliberately strict. Anything ambiguous routes to the
 * detail page where Maarten reviews + approves manually.
 */
export function isMagicApproveEligible(row: {
  status: string;
  startedAt: Date | string;
  endedAt: Date | string;
  breakMinutes: number;
  chefRateCents: number;
  clientRateCents: number;
  chefNotes: string | null;
  clientNotes: string | null;
  shiftStart: Date | string;
  shiftEnd: Date | string;
}): boolean {
  if (row.status !== "client_signed") return false;
  if (row.chefNotes && row.chefNotes.trim()) return false;
  if (row.clientNotes && row.clientNotes.trim()) return false;
  if (!row.chefRateCents || !row.clientRateCents) return false;

  const scheduledMin =
    (new Date(row.shiftEnd).getTime() - new Date(row.shiftStart).getTime()) /
    60000;
  const actualMin =
    (new Date(row.endedAt).getTime() - new Date(row.startedAt).getTime()) /
      60000 -
    row.breakMinutes;
  return Math.abs(actualMin - scheduledMin) <= 30;
}

/**
 * Approve a single shift_hours row. Atomic. Idempotent on outbox.
 *
 * Returns { ok: true, alreadyApproved?: true } on success, or
 * { ok: false, reason } when the status transition fails.
 */
export async function approveHoursRow(args: {
  hoursId: string;
  approverUserId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const updated = await db
    .update(shiftHours)
    .set({
      status: "admin_approved",
      adminApprovedAt: new Date(),
      adminApprovedBy: args.approverUserId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(shiftHours.id, args.hoursId),
        eq(shiftHours.status, "client_signed"),
      ),
    )
    .returning({
      id: shiftHours.id,
      chefId: shiftHours.chefId,
      clientId: shiftHours.clientId,
      shiftId: shiftHours.shiftId,
      workedMinutes: shiftHours.workedMinutes,
      chefRateCents: shiftHours.chefRateCents,
      clientRateCents: shiftHours.clientRateCents,
    });

  if (updated.length === 0) {
    return { ok: false, reason: "stale" };
  }
  const row = updated[0];

  await recordAuditFromRequest({
    userId: args.approverUserId,
    action: "shift_hours.admin_approved",
    resource: "shift_hours",
    resourceId: row.id,
  });

  await enqueueIntegrationEvent({
    provider: "payroll",
    eventType: "hours.approved",
    entityType: "shift_hours",
    entityId: row.id,
    payload: {
      workedMinutes: row.workedMinutes,
      chefRateCents: row.chefRateCents,
      clientRateCents: row.clientRateCents,
    },
    idempotencyKey: `hours.approved:${row.id}`,
  });

  // Load contact info + send emails + notifications.
  const [ctx] = await db
    .select({
      chefName: chefs.fullName,
      chefEmail: chefs.email,
      chefUserId: chefs.userId,
      clientName: clients.companyName,
      clientEmail: clients.email,
      clientUserId: clients.userId,
      shiftStart: shifts.startsAt,
    })
    .from(shiftHours)
    .innerJoin(chefs, eq(chefs.id, shiftHours.chefId))
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .where(eq(shiftHours.id, row.id))
    .limit(1);

  if (!ctx) return { ok: true };

  const shiftDate = new Date(ctx.shiftStart).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const chefAmount =
    computeChefAmountCents(row.workedMinutes, row.chefRateCents) / 100;
  const clientAmount =
    computeChefAmountCents(row.workedMinutes, row.clientRateCents) / 100;

  if (ctx.chefUserId) {
    await createNotification({
      userId: ctx.chefUserId,
      type: "hours_approved",
      title: "Je uren zijn goedgekeurd",
      body: "Wordt uitbetaald via payroll.",
      actionUrl: "/chef/hours",
      entityType: "shift_hours",
      entityId: row.id,
    });
  }
  if (ctx.chefEmail) {
    const send = await sendEmail({
      to: ctx.chefEmail,
      subject: "Uren goedgekeurd — wordt uitbetaald",
      react: HoursApprovedChefEmail({
        recipientName: ctx.chefName,
        clientName: ctx.clientName,
        shiftDate,
        workedHoursLabel: formatWorkedMinutes(row.workedMinutes),
        expectedAmountEur: chefAmount,
      }),
    });
    if (send.ok) {
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: ctx.chefEmail,
        template: "HoursApprovedChefEmail",
        eventKey: "hours_approved",
        entityType: "shift_hours",
        entityId: row.id,
        userId: ctx.chefUserId ?? undefined,
      });
    }
  }
  if (ctx.clientEmail) {
    const send = await sendEmail({
      to: ctx.clientEmail,
      subject: `Uren afgerond voor ${shiftDate} — factuur volgt`,
      react: HoursApprovedKlantEmail({
        recipientName: ctx.clientName,
        chefName: ctx.chefName,
        shiftDate,
        workedHoursLabel: formatWorkedMinutes(row.workedMinutes),
        clientAmountEur: clientAmount,
      }),
    });
    if (send.ok) {
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: ctx.clientEmail,
        template: "HoursApprovedKlantEmail",
        eventKey: "hours_approved",
        entityType: "shift_hours",
        entityId: row.id,
        userId: ctx.clientUserId ?? undefined,
      });
    }
  }

  // PR-KLANT-5: invite the klant to give feedback now that the shift is done.
  if (ctx.clientUserId) {
    await createNotification({
      userId: ctx.clientUserId,
      type: "rating_pending",
      title: `Geef feedback over ${ctx.chefName}`,
      body: "Je feedback helpt ons volgende matches beter te maken.",
      actionUrl: `/client/shifts/${row.shiftId}/rate`,
      entityType: "shift_hours",
      entityId: row.id,
    });
  }
  {
    const to = await recipientsForClient(row.clientId, "rating_pending");
    if (to.length > 0) {
      const send = await sendEmail({
        to,
        subject: `Geef feedback over ${ctx.chefName}`,
        react: RatingPendingKlantEmail({
          companyName: ctx.clientName,
          chefName: ctx.chefName,
          shiftDate,
          rateUrl: `${process.env.NEXT_PUBLIC_APP_URL}/client/shifts/${row.shiftId}/rate`,
        }),
      });
      if (send.ok) {
        for (const addr of to) {
          await recordEmailMessage({
            providerMessageId: send.id,
            toEmail: addr,
            template: "RatingPendingKlantEmail",
            eventKey: "rating_pending",
            entityType: "shift_hours",
            entityId: row.id,
          });
        }
      }
    }
  }

  // Side-effect markers — helps debug.
  void formatEuro; // utility may be unused depending on tree-shaking
  return { ok: true };
}

/**
 * Reject a client_signed row back to the chef for correction. Both chef
 * and klant get explanatory emails. The row's status moves to
 * `admin_rejected`. The chef portal shows the chef the adminNotes and
 * lets them resubmit.
 */
export async function rejectHoursRow(args: {
  hoursId: string;
  rejecterUserId: string;
  adminNotes: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (args.adminNotes.trim().length < 5) {
    return { ok: false, reason: "reason-too-short" };
  }

  const updated = await db
    .update(shiftHours)
    .set({
      status: "admin_rejected",
      adminRejectedAt: new Date(),
      adminNotes: args.adminNotes.trim(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(shiftHours.id, args.hoursId),
        eq(shiftHours.status, "client_signed"),
      ),
    )
    .returning({ id: shiftHours.id });

  if (updated.length === 0) return { ok: false, reason: "stale" };

  await recordAuditFromRequest({
    userId: args.rejecterUserId,
    action: "shift_hours.admin_rejected",
    resource: "shift_hours",
    resourceId: args.hoursId,
    after: { adminNotes: args.adminNotes.trim() },
  });

  const [ctx] = await db
    .select({
      placementId: shiftHours.placementId,
      chefName: chefs.fullName,
      chefEmail: chefs.email,
      chefUserId: chefs.userId,
      clientName: clients.companyName,
      clientEmail: clients.email,
      clientUserId: clients.userId,
      shiftStart: shifts.startsAt,
    })
    .from(shiftHours)
    .innerJoin(chefs, eq(chefs.id, shiftHours.chefId))
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .where(eq(shiftHours.id, args.hoursId))
    .limit(1);

  if (!ctx) return { ok: true };

  const shiftDate = new Date(ctx.shiftStart).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const editUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/chef/hours/${ctx.placementId}`;

  if (ctx.chefUserId) {
    await createNotification({
      userId: ctx.chefUserId,
      type: "hours_rejected_by_admin",
      title: "Chef & Serve heeft je uren teruggezet",
      body: args.adminNotes.trim(),
      actionUrl: "/chef/hours",
      entityType: "shift_hours",
      entityId: args.hoursId,
    });
  }
  if (ctx.clientUserId) {
    await createNotification({
      userId: ctx.clientUserId,
      type: "hours_rejected_by_admin",
      title: `Chef & Serve heeft uren van ${ctx.chefName} teruggezet`,
      body: "Wij coördineren met de chef — je hoeft niets te doen.",
      entityType: "shift_hours",
      entityId: args.hoursId,
    });
  }

  if (ctx.chefEmail) {
    const send = await sendEmail({
      to: ctx.chefEmail,
      subject: "Chef & Serve heeft je uren teruggezet",
      react: HoursRejectedByAdminEmail({
        recipientName: ctx.chefName,
        recipientRole: "chef",
        chefName: ctx.chefName,
        clientName: ctx.clientName,
        shiftDate,
        adminNote: args.adminNotes.trim(),
        editUrl,
      }),
    });
    if (send.ok) {
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: ctx.chefEmail,
        template: "HoursRejectedByAdminEmail",
        eventKey: "hours_admin_rejected",
        entityType: "shift_hours",
        entityId: args.hoursId,
        userId: ctx.chefUserId ?? undefined,
      });
    }
  }
  if (ctx.clientEmail) {
    const send = await sendEmail({
      to: ctx.clientEmail,
      subject: `Uren-correctie voor ${ctx.chefName} op ${shiftDate}`,
      react: HoursRejectedByAdminEmail({
        recipientName: ctx.clientName,
        recipientRole: "klant",
        chefName: ctx.chefName,
        clientName: ctx.clientName,
        shiftDate,
        adminNote: args.adminNotes.trim(),
      }),
    });
    if (send.ok) {
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: ctx.clientEmail,
        template: "HoursRejectedByAdminEmail",
        eventKey: "hours_admin_rejected",
        entityType: "shift_hours",
        entityId: args.hoursId,
        userId: ctx.clientUserId ?? undefined,
      });
    }
  }

  return { ok: true };
}
