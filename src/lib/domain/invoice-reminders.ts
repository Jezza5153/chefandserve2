/**
 * Chasing overdue invoices.
 *
 * Deliberately the LAST thing built in the money chain. Chasing a klant for an amount that
 * does not yet include the surcharges, the fees and the passed-on costs is worse than not
 * chasing: you send a number, they pay it, and the rest has to be argued for afterwards.
 * So this waited for free invoice lines, surcharges and declarations to land first.
 *
 * Three properties hold it together:
 *
 *  - IDEMPOTENT. `lastReminderAt` is written in the same statement that selects the invoice
 *    for chasing, so a retried cron, a manual trigger and a double-fire all collapse into
 *    one reminder. Nobody gets chased twice in a week because a worker restarted.
 *  - ESCALATING, NOT REPEATING. The wording changes with `reminderCount`: a friendly note
 *    the first time, plainer the second, and after that it stops sending and puts it in
 *    front of a human. A machine that keeps mailing a klant is how a relationship ends.
 *  - RECIPIENTS COME FROM `recipientsForClient`. Never `client.email` — that is a hard rule
 *    here, and billing mail in particular has its own address.
 *
 * Dark-launched behind INVOICE_REMINDERS_ENABLED.
 */
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, invoices } from "@/lib/db/schema";
import { dagenTeLaat } from "@/lib/domain/invoice-aging";

/** Days past the due date before the first reminder. Not the same day — that reads as distrust. */
export const EERSTE_AANMANING_NA_DAGEN = 3;
/** Minimum gap between two reminders for the same invoice. */
export const HERHAAL_NA_DAGEN = 7;
/** After this many reminders a person takes over. */
export const MAX_AANMANINGEN = 3;

export type AanmaningKandidaat = {
  invoiceId: string;
  nummer: string;
  clientId: string;
  klant: string;
  bedragCents: number;
  vervaldatum: Date;
  dagenTeLaat: number;
  eerdereAanmaningen: number;
  /** True when the ceiling is reached: do not mail, escalate to a human. */
  handmatig: boolean;
};

export function remindersEnabled(): boolean {
  return process.env.INVOICE_REMINDERS_ENABLED === "true";
}

/**
 * Which invoices are due a reminder right now.
 *
 * Read-only, so a surface can show "these five would be chased today" without sending
 * anything — the same preview-before-act shape as the group message.
 */
export async function getAanmaningKandidaten(nu: Date = new Date()): Promise<AanmaningKandidaat[]> {
  const eersteGrens = new Date(nu.getTime() - EERSTE_AANMANING_NA_DAGEN * 86_400_000);
  const herhaalGrens = new Date(nu.getTime() - HERHAAL_NA_DAGEN * 86_400_000);

  const rows = (await db
    .select({
      invoiceId: invoices.id,
      nummer: invoices.number,
      clientId: invoices.clientId,
      klant: clients.companyName,
      bedragCents: invoices.totalCents,
      vervaldatum: invoices.dueDate,
      eerdere: invoices.reminderCount,
    })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(
      and(
        eq(invoices.status, "sent"),
        lt(invoices.dueDate, eersteGrens),
        // Never chased, or last chased long enough ago.
        or(isNull(invoices.lastReminderAt), lt(invoices.lastReminderAt, herhaalGrens)),
      ),
    )) as {
    invoiceId: string; nummer: string; clientId: string; klant: string;
    bedragCents: number; vervaldatum: Date; eerdere: number;
  }[];

  return rows.map((r) => ({
    invoiceId: r.invoiceId,
    nummer: r.nummer,
    clientId: r.clientId,
    klant: r.klant,
    bedragCents: r.bedragCents,
    vervaldatum: r.vervaldatum,
    dagenTeLaat: dagenTeLaat(r.vervaldatum, nu),
    eerdereAanmaningen: r.eerdere,
    handmatig: r.eerdere >= MAX_AANMANINGEN,
  }));
}

/**
 * Claim an invoice for chasing.
 *
 * Returns false when someone (or another run) got there first. The UPDATE carries the same
 * conditions as the selection, so the claim and the check are one statement — a read then a
 * write would let two runs both decide to send.
 */
export async function claimAanmaning(invoiceId: string, nu: Date = new Date()): Promise<boolean> {
  const herhaalGrens = new Date(nu.getTime() - HERHAAL_NA_DAGEN * 86_400_000);
  const geclaimd = await db
    .update(invoices)
    .set({
      lastReminderAt: nu,
      reminderCount: sql`${invoices.reminderCount} + 1`,
      updatedAt: nu,
    })
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.status, "sent"),
        or(isNull(invoices.lastReminderAt), lt(invoices.lastReminderAt, herhaalGrens)),
        lt(invoices.reminderCount, MAX_AANMANINGEN),
      ),
    )
    .returning({ id: invoices.id });
  return geclaimd.length > 0;
}

/**
 * The tone for reminder number N.
 *
 * Escalation is in the wording, not in the frequency. Sending the same sentence four times
 * is what makes a system feel like a debt collector; saying it differently, and then
 * stopping, is what a person would do.
 */
export function aanmaningToon(nummer: number): { onderwerp: (nr: string) => string; opening: string; slot: string } {
  if (nummer <= 1) {
    return {
      onderwerp: (nr) => `Herinnering: factuur ${nr} staat nog open`,
      opening: "Waarschijnlijk is het er even bij ingeschoten, maar deze factuur staat nog open.",
      slot: "Is er iets onduidelijk aan de factuur? Laat het gerust weten, dan kijken we ernaar.",
    };
  }
  if (nummer === 2) {
    return {
      onderwerp: (nr) => `Tweede herinnering: factuur ${nr}`,
      opening: "We hebben deze factuur eerder onder de aandacht gebracht; hij staat nog steeds open.",
      slot: "Mocht betaling nu niet uitkomen, laat het weten — dan maken we samen een afspraak.",
    };
  }
  return {
    onderwerp: (nr) => `Factuur ${nr} — graag even contact`,
    opening: "Deze factuur staat al geruime tijd open en eerdere herinneringen bleven onbeantwoord.",
    slot: "We nemen binnenkort persoonlijk contact op om dit samen op te lossen.",
  };
}

export const euro = (c: number) =>
  `€ ${(c / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
