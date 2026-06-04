/**
 * Client email-recipient routing — PR-KLANT-0 (correction round 3, #3).
 *
 * THE single path for resolving who at the klant receives a given email.
 * Every klant transactional email in PR-KLANT-1..5 calls this — no call
 * site hard-codes `client.email`. This is the seam that prevents future
 * email-routing drift when hotels have planning/finance/onsite contacts.
 *
 * V1: returns the main klant email (or billingEmail for finance events).
 * V2: when `client_contacts` has rows, resolves by role with fallback.
 */

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clientContacts, clients } from "@/lib/db/schema";
import { shouldSendToUser } from "@/lib/integrations/prefs";

/** Event keys that map to klant contact roles. */
export type ClientEmailEvent =
  | "chef_proposed"
  | "hours_ready_to_sign"
  | "billing_email_changed"
  | "client_shift_change_requested"
  | "rating_pending"
  | "generic";

/** Which client_contacts role(s) an event prefers in V2. */
const EVENT_ROLE_MAP: Record<ClientEmailEvent, Array<typeof clientContacts.$inferSelect.role>> = {
  chef_proposed: ["planning", "onsite"],
  hours_ready_to_sign: ["hours_approval"],
  billing_email_changed: ["finance"],
  client_shift_change_requested: ["planning", "emergency"],
  rating_pending: ["planning"],
  generic: [],
};

/**
 * Klant-mutable email categories (PR-K2-7). These appear as toggles in
 * /client/notifications and the klant can opt out. Everything NOT listed here
 * (billing_email_changed = anti-takeover/security, generic) always sends.
 */
export const CLIENT_NOTIFICATION_PREFS: ReadonlyArray<{
  event: ClientEmailEvent;
  label: string;
  description: string;
}> = [
  {
    event: "chef_proposed",
    label: "Voorgestelde chef",
    description: "Mail wanneer we een chef voor je shift voorstellen.",
  },
  {
    event: "hours_ready_to_sign",
    label: "Uren te tekenen",
    description: "Mail wanneer een chef uren indient die jij moet aftekenen.",
  },
  {
    event: "client_shift_change_requested",
    label: "Wijzigingsverzoeken",
    description: "Mail-updates over je wijzigings- of annuleringsverzoeken.",
  },
  {
    event: "rating_pending",
    label: "Feedback-herinnering",
    description: "Mail-herinnering om feedback te geven na een shift.",
  },
];

const MUTABLE_EVENTS: ReadonlySet<ClientEmailEvent> = new Set(
  CLIENT_NOTIFICATION_PREFS.map((p) => p.event),
);

/**
 * Resolve recipient email(s) for a client + event.
 *
 * Resolution order:
 *   1. V2: active client_contacts rows matching the event's roles AND
 *      receivesNotifications=true → their emails.
 *   2. V1 fallback: billingEmail for finance events, else the main
 *      client.email. Always returns at least the fallback if it exists.
 *
 * Returns a de-duplicated, lowercased list. Empty only if the client has
 * no usable email at all (caller should skip the send).
 */
export async function recipientsForClient(
  clientId: string,
  event: ClientEmailEvent,
): Promise<string[]> {
  const [client] = await db
    .select({
      email: clients.email,
      billingEmail: clients.billingEmail,
      userId: clients.userId,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return [];

  // Respect the klant's opt-out for mutable categories (PR-K2-7). Critical mail
  // (billing/security, generic) is never mutable and always sends.
  if (MUTABLE_EVENTS.has(event) && client.userId) {
    if (!(await shouldSendToUser(client.userId, event))) return [];
  }

  const roles = EVENT_ROLE_MAP[event];
  const collected: string[] = [];

  // V2 path — resolve by role from client_contacts (table is empty in V1,
  // so this is a no-op until contacts are added).
  if (roles.length > 0) {
    const contactRows = await db
      .select({ email: clientContacts.email, role: clientContacts.role })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.clientId, clientId),
          eq(clientContacts.receivesNotifications, true),
        ),
      );
    for (const c of contactRows) {
      if (roles.includes(c.role) && c.email) collected.push(c.email);
    }
  }

  // V1 fallback — main email, or billingEmail for finance-flavored events.
  if (collected.length === 0) {
    const fallback =
      event === "billing_email_changed"
        ? client.billingEmail ?? client.email
        : client.email ?? client.billingEmail;
    if (fallback) collected.push(fallback);
  }

  // De-dup + normalize
  return [...new Set(collected.map((e) => e.trim().toLowerCase()).filter(Boolean))];
}
