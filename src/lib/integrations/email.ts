/**
 * Email delivery tracking — PR-CHEF-0 (insert) + PR-CHEF-8 (webhook update).
 *
 * Goal: know if every email arrived. Resend's webhook posts delivery events
 * (sent, delivered, bounced, complained, …) — we record them so:
 *   - Maarten sees "Daniel got the mail" on a shift detail
 *   - Bouncing addresses surface on /admin/business/integrations
 *   - The product never silently misses a comms failure
 *
 * recordEmailMessage() runs right after every sendEmail() call site. The
 * providerMessageId is Resend's id from the send response. The webhook
 * handler later looks rows up by that id to update status.
 */

import { and, desc, eq, gt, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { emailEvents, emailMessages } from "@/lib/db/schema";

export type RecordEmailMessageArgs = {
  providerMessageId: string;
  toEmail: string;
  /** Template name as a string ('HoursApprovedChefEmail' etc.) */
  template: string;
  /** Optional: NotificationEvent key when send was routable. */
  eventKey?: string;
  entityType?: string;
  entityId?: string;
  /** Optional: user the email is addressed to (lets us join to users). */
  userId?: string;
};

/** Insert one row right after sendEmail() resolves with a providerMessageId. */
export async function recordEmailMessage(
  args: RecordEmailMessageArgs,
): Promise<{ ok: boolean; messageId?: string }> {
  try {
    const [row] = await db
      .insert(emailMessages)
      .values({
        providerMessageId: args.providerMessageId,
        toEmail: args.toEmail.trim().toLowerCase(),
        template: args.template,
        eventKey: args.eventKey,
        entityType: args.entityType,
        entityId: args.entityId,
        userId: args.userId,
        status: "sent", // Resend accepted; webhook will upgrade to delivered.
      })
      .returning({ id: emailMessages.id });
    return { ok: true, messageId: row.id };
  } catch (err) {
    console.error(
      "[email] recordEmailMessage failed:",
      err instanceof Error ? err.message : "unknown",
      args.providerMessageId,
    );
    return { ok: false };
  }
}

/**
 * Map a Resend webhook event type to our internal status enum. Returns
 * null when the event is informational only (opened/clicked don't change
 * the canonical "did it arrive?" status).
 */
export function emailStatusFromProviderEvent(
  providerEventType: string,
):
  | "sent"
  | "delivered"
  | "bounced"
  | "failed"
  | "complained"
  | "suppressed"
  | null {
  switch (providerEventType) {
    case "email.sent":
      return "sent";
    case "email.delivered":
      return "delivered";
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "complained";
    case "email.delivery_delayed":
      return null; // keep current status; record event only
    case "email.failed":
      return "failed";
    case "email.opened":
    case "email.clicked":
      return null; // informational
    default:
      return null;
  }
}

/**
 * Called by /api/webhooks/resend after signature verification. Records the
 * raw event AND updates email_messages.status (only when the mapping yields
 * a non-null status). Idempotent — same provider event arriving twice just
 * appends another email_events row with the same payload.
 */
export async function recordEmailEventFromWebhook(payload: {
  type: string;
  data: { email_id?: string; [k: string]: unknown };
  [k: string]: unknown;
}): Promise<{ ok: boolean; messageId?: string }> {
  const providerMessageId = String(payload.data?.email_id ?? "");
  if (!providerMessageId) {
    console.error(
      "[email] webhook missing email_id — payload:",
      JSON.stringify(payload).slice(0, 200),
    );
    return { ok: false };
  }

  const [msg] = await db
    .select({ id: emailMessages.id, currentStatus: emailMessages.status })
    .from(emailMessages)
    .where(eq(emailMessages.providerMessageId, providerMessageId))
    .limit(1);

  if (!msg) {
    // We didn't record the send (e.g. Auth.js sent it directly). Log and
    // skip — nothing to update.
    return { ok: false };
  }

  // Always append the raw event for audit/debug.
  await db.insert(emailEvents).values({
    messageId: msg.id,
    providerEventType: payload.type,
    payloadJson: payload as unknown as Record<string, unknown>,
  });

  const newStatus = emailStatusFromProviderEvent(payload.type);
  if (newStatus) {
    await db
      .update(emailMessages)
      .set({ status: newStatus, lastEventAt: new Date() })
      .where(eq(emailMessages.id, msg.id));
  } else {
    await db
      .update(emailMessages)
      .set({ lastEventAt: new Date() })
      .where(eq(emailMessages.id, msg.id));
  }

  return { ok: true, messageId: msg.id };
}

/** Bounces in the last N days (admin home + integrations control room). */
export async function recentBounces(days: number = 7): Promise<{
  count: number;
  rows: typeof emailMessages.$inferSelect[];
}> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(emailMessages)
    .where(
      and(eq(emailMessages.status, "bounced"), gt(emailMessages.createdAt, since)),
    )
    .orderBy(desc(emailMessages.createdAt))
    .limit(50);
  return { count: rows.length, rows };
}

/** Per-entity email history (renders on shift/hours/chef detail pages). */
export async function listForEntity(args: {
  entityType: string;
  entityId: string;
}): Promise<typeof emailMessages.$inferSelect[]> {
  return db
    .select()
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.entityType, args.entityType),
        eq(emailMessages.entityId, args.entityId),
      ),
    )
    .orderBy(desc(emailMessages.createdAt));
}

/** Counts for the integration health card. */
export async function counts(days: number = 7): Promise<{
  sent: number;
  delivered: number;
  bounced: number;
  failed: number;
}> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.execute(sql`
    SELECT status, count(*)::int AS n
    FROM email_messages
    WHERE created_at > ${since.toISOString()}
    GROUP BY status
  `);
  const out = { sent: 0, delivered: 0, bounced: 0, failed: 0 };
  const list = Array.isArray(rows)
    ? rows
    : ((rows as unknown as { rows?: unknown[] }).rows ?? []);
  for (const r of list as Array<{ status: string; n: number }>) {
    if (r.status === "sent") out.sent += r.n;
    if (r.status === "delivered") out.delivered += r.n;
    if (r.status === "bounced") out.bounced += r.n;
    if (r.status === "failed") out.failed += r.n;
  }
  return out;
}
