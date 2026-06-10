/**
 * Inbound message domain (PR-AI-INBOUND) — chef/klant e-mail RECEIVED via Resend inbound.
 *
 * processInboundEmail(): parse sender → match to a chef/klant → heuristically classify
 * (klacht / spoed / vraag / overig) → store (deduped on providerMessageId) → notify Maarten for
 * anything that matters (known sender, or urgent/complaint from anyone). listRecentInbound() is the
 * AI's read surface (subject-level — never dumps the raw body).
 *
 * SECURITY: `bodyPreview` is UNTRUSTED sender content. It is stored + shown as DATA, never executed
 * as instructions. The list tool deliberately returns subject + classification only, so untrusted
 * body text never lands in the model's context unprompted.
 */
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";

import { recordAuditFromRequest } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { chefs, clientContacts, clients, inboundMessages, users } from "@/lib/db/schema";
import { inboxLabelFor, inboxRecipients, matchesViewer } from "@/lib/domain/inboxes";
import { env } from "@/lib/env";
import { createNotification } from "@/lib/integrations/notifications";

export type InboundCategory = "question" | "complaint" | "urgent" | "other";

const COMPLAINT_RE =
  /\b(klacht|ontevreden|niet tevreden|teleurgesteld|slecht|probleem|boos|geen goede|niet blij|onacceptabel|schandalig|terugbetaal|refund|complaint)\b/i;
const URGENT_RE =
  /\b(spoed|urgent|vandaag|zo snel mogelijk|asap|direct|noodgeval|per direct|dringend|nu meteen|emergency)\b/i;

const BODY_CAP = 4000;

/** "Jan Jansen <jan@x.nl>" | "jan@x.nl" → { name, email(lowercased) }. */
function parseFrom(raw: string): { email: string; name: string | null } {
  const m = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  return { name: null, email: raw.trim().toLowerCase() };
}

function classify(subject: string, body: string, matched: boolean): InboundCategory {
  const hay = `${subject}\n${body}`;
  if (URGENT_RE.test(hay)) return "urgent";
  if (COMPLAINT_RE.test(hay)) return "complaint";
  return matched ? "question" : "other";
}

async function matchSender(
  email: string,
): Promise<{ chefId: string | null; clientId: string | null; userId: string | null; label: string | null }> {
  // lower() on the column side too — stored emails can be mixed-case ("Jan@Hotel.nl").
  const lower = email.toLowerCase();

  // Internal staff first (owner/planner mailing the shared planning inbox) — roles ≠ inboxes:
  // planners have personal addresses; recognize them as INTERN, not "onbekende afzender".
  const [staff] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(sql`lower(${users.email}) = ${lower}`)
    .limit(1);
  if (staff) return { chefId: null, clientId: null, userId: staff.id, label: staff.name ?? email };

  const [chef] = await db
    .select({ id: chefs.id, name: chefs.fullName })
    .from(chefs)
    .where(sql`lower(${chefs.email}) = ${lower}`)
    .limit(1);
  if (chef) return { chefId: chef.id, clientId: null, userId: null, label: chef.name };

  const [client] = await db
    .select({ id: clients.id, name: clients.companyName })
    .from(clients)
    .where(sql`lower(${clients.email}) = ${lower}`)
    .limit(1);
  if (client) return { chefId: null, clientId: client.id, userId: null, label: client.name };

  const [contact] = await db
    .select({ clientId: clientContacts.clientId, name: clientContacts.name })
    .from(clientContacts)
    .where(sql`lower(${clientContacts.email}) = ${lower}`)
    .limit(1);
  if (contact) {
    const [c] = await db
      .select({ name: clients.companyName })
      .from(clients)
      .where(eq(clients.id, contact.clientId))
      .limit(1);
    return { chefId: null, clientId: contact.clientId, userId: null, label: c?.name ?? contact.name };
  }
  return { chefId: null, clientId: null, userId: null, label: null };
}

export type ProcessInboundInput = {
  fromRaw: string;
  to?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  providerMessageId?: string | null;
  provider?: string;
};

export async function processInboundEmail(input: ProcessInboundInput): Promise<{
  id: string | null;
  deduped: boolean;
  category: InboundCategory;
  matched: boolean;
  notified: boolean;
}> {
  const { email, name } = parseFrom(input.fromRaw);
  const subject = (input.subject ?? "").slice(0, 500);
  const body = (input.bodyText ?? "").slice(0, BODY_CAP);

  const m = await matchSender(email);
  const matched = Boolean(m.chefId || m.clientId || m.userId);
  const category = classify(subject, body, matched);

  const inserted = await db
    .insert(inboundMessages)
    .values({
      provider: input.provider ?? "resend",
      providerMessageId: input.providerMessageId ?? null,
      fromEmail: email,
      fromName: name,
      toEmail: input.to ?? null,
      subject: subject || null,
      bodyPreview: body || null,
      matchedChefId: m.chefId,
      matchedClientId: m.clientId,
      matchedUserId: m.userId,
      category,
    })
    .onConflictDoNothing({ target: inboundMessages.providerMessageId })
    .returning({ id: inboundMessages.id });

  const id = inserted[0]?.id ?? null;
  const deduped = inserted.length === 0;

  // Notify — only for what matters (a known sender, or urgent/complaint from anyone).
  // Unknown-sender "other" (likely spam/newsletter) is stored but stays quiet.
  // Recipients: the members of the inbox this mail was addressed to (inbox-access mapping);
  // no mapping → fallback to the owner (pre-config behaviour).
  let notified = false;
  if (!deduped && (matched || category === "urgent" || category === "complaint")) {
    let recipientIds = await inboxRecipients(input.to ?? null).catch(() => [] as string[]);
    if (recipientIds.length === 0 && env.MAARTEN_EMAIL) {
      const [owner] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, env.MAARTEN_EMAIL))
        .limit(1);
      recipientIds = owner ? [owner.id] : [];
    }
    const who = m.userId ? `${m.label ?? email} (intern)` : (m.label ?? name ?? email);
    const tag = category === "complaint" ? "⚠ Klacht" : category === "urgent" ? "⏱ Spoed" : "Bericht";
    for (const userId of recipientIds) {
      const res = await createNotification({
        userId,
        type: "inbound_message",
        title: `${tag} van ${who}`,
        body: subject ? `Onderwerp: "${subject}".` : "Nieuw binnengekomen bericht.",
        actionUrl: "/admin/business/berichten",
        entityType: m.chefId ? "chefs" : m.clientId ? "clients" : undefined,
        entityId: m.chefId ?? m.clientId ?? undefined,
      });
      notified = notified || res.ok;
    }
  }
  return { id, deduped, category, matched, notified };
}

export type InboundListItem = {
  id: string;
  from: string;
  subject: string | null;
  category: InboundCategory;
  matchedTo: "chef" | "klant" | "intern" | null;
  /** Label of the configured inbox this mail belongs to (null = no configured inbox matches). */
  inbox: string | null;
  receivedAt: string;
  handled: boolean;
};

export type InboundAdminRow = {
  id: string;
  fromEmail: string;
  fromName: string | null;
  toEmail: string | null;
  subject: string | null;
  /** UNTRUSTED sender text — render escaped (plain text), never as HTML. */
  bodyPreview: string | null;
  category: InboundCategory;
  matchedChefId: string | null;
  matchedClientId: string | null;
  matchedUserId: string | null;
  chefName: string | null;
  clientName: string | null;
  userName: string | null;
  handledAt: Date | null;
  createdAt: Date;
};

/** Admin (Berichten page) read: full rows incl. body, joined chef/klant names. */
export async function listInboundAdmin(opts?: {
  unhandledOnly?: boolean;
  category?: InboundCategory;
  limit?: number;
}): Promise<InboundAdminRow[]> {
  const conditions: SQL[] = [];
  if (opts?.unhandledOnly) conditions.push(isNull(inboundMessages.handledAt));
  if (opts?.category) conditions.push(eq(inboundMessages.category, opts.category));
  const rows = await db
    .select({
      id: inboundMessages.id,
      fromEmail: inboundMessages.fromEmail,
      fromName: inboundMessages.fromName,
      toEmail: inboundMessages.toEmail,
      subject: inboundMessages.subject,
      bodyPreview: inboundMessages.bodyPreview,
      category: inboundMessages.category,
      matchedChefId: inboundMessages.matchedChefId,
      matchedClientId: inboundMessages.matchedClientId,
      matchedUserId: inboundMessages.matchedUserId,
      chefName: chefs.fullName,
      clientName: clients.companyName,
      userName: users.name,
      handledAt: inboundMessages.handledAt,
      createdAt: inboundMessages.createdAt,
    })
    .from(inboundMessages)
    .leftJoin(chefs, eq(inboundMessages.matchedChefId, chefs.id))
    .leftJoin(clients, eq(inboundMessages.matchedClientId, clients.id))
    .leftJoin(users, eq(inboundMessages.matchedUserId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(inboundMessages.createdAt))
    .limit(Math.min(opts?.limit ?? 100, 200));
  return rows.map((r) => ({ ...r, category: r.category as InboundCategory }));
}

/** Mark a message afgehandeld (or reopen it). Audited; no message content in the audit. */
export async function setInboundHandled(args: {
  id: string;
  handled: boolean;
  actorId: string;
}): Promise<{ ok: boolean }> {
  const [row] = await db
    .update(inboundMessages)
    .set({ handledAt: args.handled ? new Date() : null })
    .where(eq(inboundMessages.id, args.id))
    .returning({ id: inboundMessages.id });
  if (!row) return { ok: false };
  await recordAuditFromRequest({
    userId: args.actorId,
    action: args.handled ? "inbound_messages.handled" : "inbound_messages.reopened",
    resource: "inbound_messages",
    resourceId: args.id,
    after: { handled: args.handled },
  });
  return { ok: true };
}

/**
 * The AI's read surface — subject + classification only (never the raw untrusted body).
 * Pass `viewer` (the asking human's inbox filter) so the assistant inherits EXACTLY the same
 * inbox access as the person asking: a planner's AI never sees the owners' boxes; the owners
 * see per their own grants (+ stray mail); super_admin sees all. No filter = unrestricted
 * (only for internal/cron callers — never for a chat surface).
 */
export async function listRecentInbound(opts?: {
  unhandledOnly?: boolean;
  limit?: number;
  viewer?: import("@/lib/domain/inboxes").ViewerInboxFilter;
  inboxLabels?: { address: string; label: string }[];
}): Promise<InboundListItem[]> {
  const limit = Math.min(opts?.limit ?? 20, 50);
  const rows = await db
    .select({
      id: inboundMessages.id,
      fromEmail: inboundMessages.fromEmail,
      fromName: inboundMessages.fromName,
      toEmail: inboundMessages.toEmail,
      subject: inboundMessages.subject,
      category: inboundMessages.category,
      chefId: inboundMessages.matchedChefId,
      clientId: inboundMessages.matchedClientId,
      userId: inboundMessages.matchedUserId,
      createdAt: inboundMessages.createdAt,
      handledAt: inboundMessages.handledAt,
    })
    .from(inboundMessages)
    .where(opts?.unhandledOnly ? isNull(inboundMessages.handledAt) : undefined)
    .orderBy(desc(inboundMessages.createdAt))
    .limit(limit);
  const viewer = opts?.viewer;
  const visible = viewer ? rows.filter((r) => matchesViewer(r.toEmail, viewer)) : rows;
  return visible.map((r) => ({
    id: r.id,
    from: r.fromName ? `${r.fromName} <${r.fromEmail}>` : r.fromEmail,
    subject: r.subject,
    category: r.category as InboundCategory,
    matchedTo: r.chefId ? "chef" : r.clientId ? "klant" : r.userId ? "intern" : null,
    inbox: opts?.inboxLabels ? inboxLabelFor(r.toEmail, opts.inboxLabels) : null,
    receivedAt: r.createdAt.toISOString(),
    handled: r.handledAt != null,
  }));
}
