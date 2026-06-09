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
import { desc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clientContacts, clients, inboundMessages, users } from "@/lib/db/schema";
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
): Promise<{ chefId: string | null; clientId: string | null; label: string | null }> {
  const lower = email.toLowerCase();
  const [chef] = await db
    .select({ id: chefs.id, name: chefs.fullName })
    .from(chefs)
    .where(eq(chefs.email, lower))
    .limit(1);
  if (chef) return { chefId: chef.id, clientId: null, label: chef.name };

  const [client] = await db
    .select({ id: clients.id, name: clients.companyName })
    .from(clients)
    .where(eq(clients.email, lower))
    .limit(1);
  if (client) return { chefId: null, clientId: client.id, label: client.name };

  const [contact] = await db
    .select({ clientId: clientContacts.clientId, name: clientContacts.name })
    .from(clientContacts)
    .where(eq(clientContacts.email, lower))
    .limit(1);
  if (contact) {
    const [c] = await db
      .select({ name: clients.companyName })
      .from(clients)
      .where(eq(clients.id, contact.clientId))
      .limit(1);
    return { chefId: null, clientId: contact.clientId, label: c?.name ?? contact.name };
  }
  return { chefId: null, clientId: null, label: null };
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
  const matched = Boolean(m.chefId || m.clientId);
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
      category,
    })
    .onConflictDoNothing({ target: inboundMessages.providerMessageId })
    .returning({ id: inboundMessages.id });

  const id = inserted[0]?.id ?? null;
  const deduped = inserted.length === 0;

  // Notify Maarten — only for what matters (a known sender, or urgent/complaint from anyone).
  // Unknown-sender "other" (likely spam/newsletter) is stored but stays quiet.
  let notified = false;
  if (!deduped && (matched || category === "urgent" || category === "complaint") && env.MAARTEN_EMAIL) {
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, env.MAARTEN_EMAIL))
      .limit(1);
    if (owner) {
      const who = m.label ?? name ?? email;
      const tag = category === "complaint" ? "⚠ Klacht" : category === "urgent" ? "⏱ Spoed" : "Bericht";
      const res = await createNotification({
        userId: owner.id,
        type: "inbound_message",
        title: `${tag} van ${who}`,
        body: subject ? `Onderwerp: "${subject}".` : "Nieuw binnengekomen bericht.",
        actionUrl: "/admin/business",
        entityType: m.chefId ? "chefs" : m.clientId ? "clients" : undefined,
        entityId: m.chefId ?? m.clientId ?? undefined,
      });
      notified = res.ok;
    }
  }
  return { id, deduped, category, matched, notified };
}

export type InboundListItem = {
  id: string;
  from: string;
  subject: string | null;
  category: InboundCategory;
  matchedTo: "chef" | "klant" | null;
  receivedAt: string;
  handled: boolean;
};

/** The AI's read surface — subject + classification only (never the raw untrusted body). */
export async function listRecentInbound(opts?: {
  unhandledOnly?: boolean;
  limit?: number;
}): Promise<InboundListItem[]> {
  const limit = Math.min(opts?.limit ?? 20, 50);
  const rows = await db
    .select({
      id: inboundMessages.id,
      fromEmail: inboundMessages.fromEmail,
      fromName: inboundMessages.fromName,
      subject: inboundMessages.subject,
      category: inboundMessages.category,
      chefId: inboundMessages.matchedChefId,
      clientId: inboundMessages.matchedClientId,
      createdAt: inboundMessages.createdAt,
      handledAt: inboundMessages.handledAt,
    })
    .from(inboundMessages)
    .where(opts?.unhandledOnly ? isNull(inboundMessages.handledAt) : undefined)
    .orderBy(desc(inboundMessages.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    from: r.fromName ? `${r.fromName} <${r.fromEmail}>` : r.fromEmail,
    subject: r.subject,
    category: r.category as InboundCategory,
    matchedTo: r.chefId ? "chef" : r.clientId ? "klant" : null,
    receivedAt: r.createdAt.toISOString(),
    handled: r.handledAt != null,
  }));
}
