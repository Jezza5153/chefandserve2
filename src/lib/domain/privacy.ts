/**
 * Privacy-request operations (PR-AVG-1) — AVG/GDPR data-subject workflow.
 *
 * A data subject (chef, klant contact, or off-portal person) files a request;
 * a super_admin works it: verify identity → correspond → (export/correct/erase
 * in PR-AVG-2) → decide, all within the 30-day SLA (extendable, art. 12(3)).
 *
 * Plain `.ts` domain — emails are template-function calls (no JSX literals),
 * same style as `domain/hours.ts`. Page-level server actions wrap these.
 */

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  auditLog,
  privacyRequestMessages,
  privacyRequests,
  users,
} from "@/lib/db/schema";
import { PrivacyRequestExtensionEmail } from "@/emails/PrivacyRequestExtensionEmail";
import { PrivacyRequestOutcomeEmail } from "@/emails/PrivacyRequestOutcomeEmail";
import { PrivacyRequestReceivedAdminEmail } from "@/emails/PrivacyRequestReceivedAdminEmail";
import { sendEmail } from "@/lib/email";
import { recordEmailMessage } from "@/lib/integrations";
import { recipientsFor } from "@/lib/notifications";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";
const SLA_DAYS = 30;

type RequestType = "access" | "correction" | "deletion" | "export" | "other";
type Channel = "portal" | "email" | "phone" | "whatsapp" | "letter";
type RequesterKind = "chef" | "klant" | "unknown" | "external";
type IdentityStatus = "not_started" | "requested" | "verified" | "failed";

function fmtDate(d: Date): string {
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

/** Resolve who to email for outcome/extension notices (account or off-portal). */
async function resolveRequesterContact(req: {
  userId: string | null;
  requesterEmail: string | null;
  requesterName: string | null;
}): Promise<{ email: string | null; name: string | null }> {
  if (req.userId) {
    const [u] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, req.userId))
      .limit(1);
    if (u?.email) return { email: u.email, name: u.name ?? req.requesterName };
  }
  return { email: req.requesterEmail, name: req.requesterName };
}

export async function createPrivacyRequest(args: {
  userId?: string | null;
  type: RequestType;
  reason?: string | null;
  requesterKind?: RequesterKind;
  requesterName?: string | null;
  requesterEmail?: string | null;
  requesterPhone?: string | null;
  originalChannel: Channel;
  rawRequestText?: string | null;
  identityStatus?: IdentityStatus;
  actorId?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const dueDate = new Date(Date.now() + SLA_DAYS * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(privacyRequests)
    .values({
      userId: args.userId ?? null,
      type: args.type,
      reason: args.reason ?? null,
      dueDate,
      requesterKind: args.requesterKind ?? null,
      requesterName: args.requesterName ?? null,
      requesterEmail: args.requesterEmail?.trim().toLowerCase() ?? null,
      requesterPhone: args.requesterPhone ?? null,
      originalChannel: args.originalChannel,
      rawRequestText: args.rawRequestText ?? null,
      identityStatus: args.identityStatus ?? "not_started",
      identityVerifiedAt: args.identityStatus === "verified" ? new Date() : null,
    })
    .returning({ id: privacyRequests.id });

  await db.insert(auditLog).values({
    userId: args.actorId ?? args.userId ?? null,
    action: "privacy.request_created",
    resource: "privacy_requests",
    resourceId: row.id,
    after: { type: args.type, channel: args.originalChannel },
  });

  // Notify the privacy-routable admins.
  const to = await recipientsFor("privacy_request");
  if (to.length > 0) {
    const label =
      args.requesterName ??
      args.requesterEmail ??
      (args.userId ? `account ${args.userId}` : "onbekend");
    const send = await sendEmail({
      to,
      subject: `Privacyverzoek (${args.type}) — ${label}`,
      react: PrivacyRequestReceivedAdminEmail({
        requesterLabel: label,
        type: args.type,
        channel: args.originalChannel,
        dueDate: fmtDate(dueDate),
        adminUrl: `${APP_URL}/admin/system/privacy-requests/${row.id}`,
      }),
    });
    if (send.ok) {
      for (const addr of to) {
        await recordEmailMessage({
          providerMessageId: send.id,
          toEmail: addr,
          template: "PrivacyRequestReceivedAdminEmail",
          eventKey: "privacy_request",
          entityType: "privacy_requests",
          entityId: row.id,
        });
      }
    }
  }

  return { ok: true, id: row.id };
}

export async function claimPrivacyRequest(args: {
  requestId: string;
  actorId: string;
}): Promise<{ ok: boolean }> {
  const updated = await db
    .update(privacyRequests)
    .set({ status: "in_progress", handledBy: args.actorId, updatedAt: new Date() })
    .where(and(eq(privacyRequests.id, args.requestId), eq(privacyRequests.status, "pending")))
    .returning({ id: privacyRequests.id });
  if (updated.length === 0) return { ok: false };
  await db.insert(auditLog).values({
    userId: args.actorId,
    action: "privacy.request_claimed",
    resource: "privacy_requests",
    resourceId: args.requestId,
  });
  return { ok: true };
}

export async function setIdentityVerification(args: {
  requestId: string;
  actorId: string;
  status: IdentityStatus;
  method?: string | null;
  notes?: string | null;
}): Promise<{ ok: boolean }> {
  await db
    .update(privacyRequests)
    .set({
      identityStatus: args.status,
      identityMethod: args.method ?? null,
      identityNotes: args.notes ?? null,
      identityVerifiedAt: args.status === "verified" ? new Date() : null,
      identityVerifiedBy: args.status === "verified" ? args.actorId : null,
      updatedAt: new Date(),
    })
    .where(eq(privacyRequests.id, args.requestId));
  await db.insert(auditLog).values({
    userId: args.actorId,
    action: "privacy.identity_verified",
    resource: "privacy_requests",
    resourceId: args.requestId,
    after: { status: args.status, method: args.method ?? null },
  });
  return { ok: true };
}

export async function logRequestMessage(args: {
  requestId: string;
  actorId: string;
  direction: "inbound" | "outbound" | "internal_note";
  channel: Channel;
  body: string;
}): Promise<{ ok: boolean }> {
  const body = args.body.trim();
  if (!body) return { ok: false };
  const [row] = await db
    .insert(privacyRequestMessages)
    .values({
      privacyRequestId: args.requestId,
      direction: args.direction,
      channel: args.channel,
      body,
      createdBy: args.actorId,
    })
    .returning({ id: privacyRequestMessages.id });
  await db.insert(auditLog).values({
    userId: args.actorId,
    action: "privacy.message_logged",
    resource: "privacy_request_messages",
    resourceId: row.id,
    after: { requestId: args.requestId, direction: args.direction },
  });
  return { ok: true };
}

export async function extendSla(args: {
  requestId: string;
  actorId: string;
  reason: string;
  newDueDate: Date;
}): Promise<{ ok: boolean }> {
  const reason = args.reason.trim();
  if (!reason) return { ok: false };
  const [req] = await db
    .select()
    .from(privacyRequests)
    .where(eq(privacyRequests.id, args.requestId))
    .limit(1);
  if (!req) return { ok: false };

  const contact = await resolveRequesterContact(req);
  let notifiedAt: Date | null = null;
  if (contact.email) {
    const send = await sendEmail({
      to: contact.email,
      subject: "Verlenging behandeltermijn privacyverzoek",
      react: PrivacyRequestExtensionEmail({
        requesterName: contact.name,
        newDueDate: fmtDate(args.newDueDate),
        reason,
      }),
    });
    if (send.ok) {
      notifiedAt = new Date();
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: contact.email,
        template: "PrivacyRequestExtensionEmail",
        eventKey: "privacy_request",
        entityType: "privacy_requests",
        entityId: args.requestId,
      });
    }
  }

  await db
    .update(privacyRequests)
    .set({
      dueDate: args.newDueDate,
      slaExtendedAt: new Date(),
      slaExtendedBy: args.actorId,
      slaExtensionReason: reason,
      slaExtensionNotifiedAt: notifiedAt,
      updatedAt: new Date(),
    })
    .where(eq(privacyRequests.id, args.requestId));
  await db.insert(auditLog).values({
    userId: args.actorId,
    action: "privacy.request_extended",
    resource: "privacy_requests",
    resourceId: args.requestId,
    after: { newDueDate: args.newDueDate.toISOString(), reason, notified: Boolean(notifiedAt) },
  });
  return { ok: true };
}

export async function withdrawRequest(args: {
  requestId: string;
  actorId: string;
  notes?: string | null;
}): Promise<{ ok: boolean }> {
  const updated = await db
    .update(privacyRequests)
    .set({ status: "withdrawn", decisionNotes: args.notes ?? null, updatedAt: new Date() })
    .where(
      and(
        eq(privacyRequests.id, args.requestId),
        inArray(privacyRequests.status, ["pending", "in_progress"]),
      ),
    )
    .returning({ id: privacyRequests.id });
  if (updated.length === 0) return { ok: false };
  await db.insert(auditLog).values({
    userId: args.actorId,
    action: "privacy.request_withdrawn",
    resource: "privacy_requests",
    resourceId: args.requestId,
    after: { notes: args.notes ?? null },
  });
  return { ok: true };
}

export async function decidePrivacyRequest(args: {
  requestId: string;
  actorId: string;
  outcome: "fulfilled" | "partially_fulfilled" | "rejected";
  decisionNotes?: string | null;
  retainedExplanation?: string | null;
}): Promise<{ ok: boolean }> {
  const updated = await db
    .update(privacyRequests)
    .set({
      status: args.outcome,
      handledBy: args.actorId,
      decisionNotes: args.decisionNotes ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(privacyRequests.id, args.requestId),
        inArray(privacyRequests.status, ["pending", "in_progress"]),
      ),
    )
    .returning({
      id: privacyRequests.id,
      type: privacyRequests.type,
      userId: privacyRequests.userId,
      requesterEmail: privacyRequests.requesterEmail,
      requesterName: privacyRequests.requesterName,
    });
  if (updated.length === 0) return { ok: false };
  const req = updated[0];

  await db.insert(auditLog).values({
    userId: args.actorId,
    action: args.outcome === "rejected" ? "privacy.rejected" : "privacy.fulfilled",
    resource: "privacy_requests",
    resourceId: args.requestId,
    after: { outcome: args.outcome },
  });

  const contact = await resolveRequesterContact(req);
  if (contact.email) {
    const send = await sendEmail({
      to: contact.email,
      subject: `Privacyverzoek (${req.type}) — uitkomst`,
      react: PrivacyRequestOutcomeEmail({
        requesterName: contact.name,
        type: req.type,
        outcome: args.outcome,
        decisionNotes: args.decisionNotes,
        retainedExplanation: args.retainedExplanation,
      }),
    });
    if (send.ok) {
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: contact.email,
        template: "PrivacyRequestOutcomeEmail",
        eventKey: "privacy_request",
        entityType: "privacy_requests",
        entityId: args.requestId,
      });
    }
  }
  return { ok: true };
}
