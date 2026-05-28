/**
 * Client shift change/cancel requests + submission self-cancel (PR-KLANT-2).
 *
 * The klant is never trapped: on ANY shift status they can request a change
 * or cancellation, and they can retract a still-pending portal submission.
 * Chefs are already committed to real shifts, so change/cancel are REQUESTS
 * that Chef & Serve mediates — never an instant mutation.
 *
 * Plain domain functions (no "use server"); page-level server actions wrap
 * these after resolving the session → ownership. All emails route through
 * recipientsForClient() (klant) / recipientsFor() (admin) per the seam rule.
 */

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import {
  clientShiftChangeRequests,
  clientSubmissions,
  clients,
  shifts,
} from "@/lib/db/schema";
import { ClientChangeRequestAdminEmail } from "@/emails/ClientChangeRequestAdminEmail";
import { ClientChangeRequestOutcomeKlantEmail } from "@/emails/ClientChangeRequestOutcomeKlantEmail";
import { recipientsForClient } from "@/lib/domain/client-recipients";
import { sendEmail, formatShiftWhen } from "@/lib/email";
import { createNotification, recordEmailMessage } from "@/lib/integrations";
import { recipientsFor } from "@/lib/notifications";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

export type ShiftChangeKind = "change" | "cancel";

type CreateArgs = {
  shiftId: string;
  clientId: string;
  requestedBy: string;
  kind: ShiftChangeKind;
  reason: string;
  /** Optional structured payload, e.g. { topic, startsAt, headcount }. */
  proposedChange?: Record<string, unknown> | null;
};

type CreateResult =
  | { ok: true; id: string }
  | { ok: false; error: "duplicate" | "invalid" | "not_found" | "db" };

/**
 * File a change/cancel request for an existing shift. Enforces:
 *   - ownership (shift must belong to clientId)
 *   - reason >= 5 chars
 *   - one OPEN request per shift per kind (pre-check + unique-index backstop)
 */
export async function createShiftChangeRequest(
  args: CreateArgs,
): Promise<CreateResult> {
  const reason = args.reason.trim();
  if (reason.length < 5) return { ok: false, error: "invalid" };

  const [shift] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, args.shiftId))
    .limit(1);
  if (!shift || shift.clientId !== args.clientId) {
    return { ok: false, error: "not_found" };
  }

  // Pre-check: any open request of this kind already?
  const existing = await db
    .select({ id: clientShiftChangeRequests.id })
    .from(clientShiftChangeRequests)
    .where(
      and(
        eq(clientShiftChangeRequests.shiftId, args.shiftId),
        eq(clientShiftChangeRequests.kind, args.kind),
        inArray(clientShiftChangeRequests.status, ["pending", "in_progress"]),
      ),
    )
    .limit(1);
  if (existing.length > 0) return { ok: false, error: "duplicate" };

  let reqId: string;
  try {
    const [row] = await db
      .insert(clientShiftChangeRequests)
      .values({
        shiftId: args.shiftId,
        clientId: args.clientId,
        requestedBy: args.requestedBy,
        kind: args.kind,
        reason,
        proposedChange: (args.proposedChange ?? null) as never,
      })
      .returning({ id: clientShiftChangeRequests.id });
    reqId = row.id;
  } catch (err) {
    // Unique-index backstop (race against the pre-check).
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("client_shift_change_open_unique") || msg.includes("23505")) {
      return { ok: false, error: "duplicate" };
    }
    console.error("[shift-change] insert failed:", msg);
    return { ok: false, error: "db" };
  }

  await recordAuditFromRequest({
    userId: args.requestedBy,
    action: args.kind === "cancel" ? "client_shift_change.cancel_requested" : "client_shift_change.change_requested",
    resource: "client_shift_change_requests",
    resourceId: reqId,
    after: { shiftId: args.shiftId, kind: args.kind, reason },
  });

  // Notify admins (reuse the existing klant-request route).
  const [client] = await db
    .select({ companyName: clients.companyName })
    .from(clients)
    .where(eq(clients.id, args.clientId))
    .limit(1);
  const adminEmails = await recipientsFor("client_portal_request");
  if (adminEmails.length > 0) {
    const send = await sendEmail({
      to: adminEmails,
      subject: `${args.kind === "cancel" ? "Annuleringsverzoek" : "Wijzigingsverzoek"} van ${client?.companyName ?? "klant"}`,
      react: (
        <ClientChangeRequestAdminEmail
          companyName={client?.companyName ?? "Klant"}
          kind={args.kind}
          shiftWhen={formatShiftWhen(shift.startsAt, shift.endsAt)}
          shiftRole={shift.roleNeeded}
          reason={reason}
          adminUrl={`${APP_URL}/admin/business/shifts/${args.shiftId}`}
        />
      ),
    });
    if (send.ok) {
      for (const to of adminEmails) {
        await recordEmailMessage({
          providerMessageId: send.id,
          toEmail: to,
          template: "ClientChangeRequestAdminEmail",
          eventKey: "client_shift_change_requested",
          entityType: "client_shift_change_requests",
          entityId: reqId,
        });
      }
    }
  }

  return { ok: true, id: reqId };
}

type CancelSubmissionResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "wrong_status" | "not_owner" };

/**
 * Klant retracts a still-pending portal submission. Only their own
 * (source='client_portal' + companyName match) and only while new/triaged.
 */
export async function cancelClientSubmission(args: {
  submissionId: string;
  client: { id: string; companyName: string };
  requestedBy: string;
  reason: string;
}): Promise<CancelSubmissionResult> {
  const [sub] = await db
    .select()
    .from(clientSubmissions)
    .where(eq(clientSubmissions.id, args.submissionId))
    .limit(1);
  if (!sub) return { ok: false, error: "not_found" };
  if (sub.source !== "client_portal" || sub.companyName !== args.client.companyName) {
    return { ok: false, error: "not_owner" };
  }

  // Atomic transition — only retract a still-open submission.
  const updated = await db
    .update(clientSubmissions)
    .set({
      status: "cancelled_by_client",
      cancelledByClientAt: new Date(),
      cancelledByClientReason: args.reason.trim() || null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(clientSubmissions.id, args.submissionId),
        inArray(clientSubmissions.status, ["new", "triaged"]),
      ),
    )
    .returning({ id: clientSubmissions.id });
  if (updated.length === 0) return { ok: false, error: "wrong_status" };

  await recordAuditFromRequest({
    userId: args.requestedBy,
    action: "client_submission.cancelled_by_client",
    resource: "client_submissions",
    resourceId: args.submissionId,
    after: { reason: args.reason.trim() || null },
  });

  // Tell admins it was retracted (silent if no route configured).
  const adminEmails = await recipientsFor("client_portal_request");
  if (adminEmails.length > 0) {
    const send = await sendEmail({
      to: adminEmails,
      subject: `Aanvraag ingetrokken door ${args.client.companyName}`,
      react: (
        <div>
          <h1>{`${args.client.companyName} heeft een aanvraag ingetrokken`}</h1>
          <p>
            <strong>Rol:</strong> {sub.roleRequested ?? "—"}
            <br />
            <strong>Datum:</strong> {sub.dateNeeded ?? "—"}
            <br />
            <strong>Reden:</strong> {args.reason.trim() || "(geen opgegeven)"}
          </p>
        </div>
      ),
    });
    if (send.ok) {
      for (const to of adminEmails) {
        await recordEmailMessage({
          providerMessageId: send.id,
          toEmail: to,
          template: "ClientSubmissionCancelledInline",
          eventKey: "client_portal_request",
          entityType: "client_submissions",
          entityId: args.submissionId,
        });
      }
    }
  }

  return { ok: true };
}

type DecideResult = { ok: true } | { ok: false; error: "not_found" | "wrong_status" };

/**
 * Admin decides a shift change/cancel request. Marks the row + emails the
 * klant the outcome. Does NOT itself mutate the shift/placements — the admin
 * does that explicitly in the shift detail UI (chefs are committed; the human
 * coordinates the actual change). This records the decision + closes the loop.
 */
export async function decideShiftChangeRequest(args: {
  requestId: string;
  decidedBy: string;
  decision: "approved" | "rejected";
  decisionNotes?: string | null;
}): Promise<DecideResult> {
  const [req] = await db
    .select()
    .from(clientShiftChangeRequests)
    .where(eq(clientShiftChangeRequests.id, args.requestId))
    .limit(1);
  if (!req) return { ok: false, error: "not_found" };

  const updated = await db
    .update(clientShiftChangeRequests)
    .set({
      status: args.decision,
      decidedAt: new Date(),
      decidedBy: args.decidedBy,
      decisionNotes: args.decisionNotes?.trim() || null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(clientShiftChangeRequests.id, args.requestId),
        inArray(clientShiftChangeRequests.status, ["pending", "in_progress"]),
      ),
    )
    .returning({ id: clientShiftChangeRequests.id });
  if (updated.length === 0) return { ok: false, error: "wrong_status" };

  await recordAuditFromRequest({
    userId: args.decidedBy,
    action: args.decision === "approved" ? "client_shift_change.approved" : "client_shift_change.rejected",
    resource: "client_shift_change_requests",
    resourceId: args.requestId,
    after: { decision: args.decision, decisionNotes: args.decisionNotes?.trim() || null },
  });

  // Outcome email + notification to the klant.
  const [shift] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, req.shiftId))
    .limit(1);
  const [client] = await db
    .select({ companyName: clients.companyName, contactName: clients.contactName, userId: clients.userId })
    .from(clients)
    .where(eq(clients.id, req.clientId))
    .limit(1);

  const to = await recipientsForClient(req.clientId, "client_shift_change_requested");
  if (shift && to.length > 0) {
    const send = await sendEmail({
      to,
      subject:
        args.decision === "approved"
          ? `${req.kind === "cancel" ? "Annulering" : "Wijziging"} doorgevoerd`
          : `${req.kind === "cancel" ? "Annulering" : "Wijziging"} niet doorgevoerd`,
      react: (
        <ClientChangeRequestOutcomeKlantEmail
          contactName={client?.contactName}
          companyName={client?.companyName ?? "uw bedrijf"}
          kind={req.kind}
          outcome={args.decision}
          shiftWhen={formatShiftWhen(shift.startsAt, shift.endsAt)}
          shiftRole={shift.roleNeeded}
          decisionNotes={args.decisionNotes?.trim() || null}
          shiftUrl={`${APP_URL}/client/shifts/${req.shiftId}`}
        />
      ),
    });
    if (send.ok) {
      for (const addr of to) {
        await recordEmailMessage({
          providerMessageId: send.id,
          toEmail: addr,
          template: "ClientChangeRequestOutcomeKlantEmail",
          eventKey: "client_shift_change_requested",
          entityType: "client_shift_change_requests",
          entityId: args.requestId,
        });
      }
    }
  }
  if (client?.userId) {
    await createNotification({
      userId: client.userId,
      type: "client_shift_change_decided",
      title:
        args.decision === "approved"
          ? `Je ${req.kind === "cancel" ? "annulering" : "wijziging"} is doorgevoerd`
          : `Je ${req.kind === "cancel" ? "annulering" : "wijziging"} is niet doorgevoerd`,
      body: args.decisionNotes?.trim() || undefined,
      actionUrl: `/client/shifts/${req.shiftId}`,
      entityType: "client_shift_change_requests",
      entityId: args.requestId,
    });
  }

  return { ok: true };
}
