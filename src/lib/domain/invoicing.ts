/**
 * Invoicing (facturatie) domain — PR-INVOICE-A2.
 *
 * The klant-billing side of the hours chain. Payroll (`/admin/business/payroll`)
 * turns admin_approved hours into a chef-PAYOUT batch; this turns the SAME hours
 * into a klant INVOICE. Both bill by `shifts.startsAt`, so a given shift lands in
 * the same period for cost AND revenue — margin reconciles.
 *
 * Design rules (mirrors payroll + the financial hard-rules in CLAUDE.md):
 *   - An invoice is a SELF-CONTAINED record: the billing details (name, address,
 *     KVK, BTW) are SNAPSHOT from the client at generation time, never re-derived.
 *     Editing the client later never rewrites an issued invoice.
 *   - Generation is IDEMPOTENT per (client, period): the unique index guarantees
 *     one invoice per period; a second call returns the existing one.
 *   - Hours already on ANY invoice are never billed twice (left-join guard), so a
 *     manual re-run with a shifted period can't double-charge.
 *   - Header + lines + audit commit ATOMICALLY (`withTx`) — never a half invoice.
 *   - Invoice numbers are sequential per calendar year ("2026-0001"); the unique
 *     `number` column + a retry loop make concurrent allocation safe.
 */
import { and, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";

import { recordAuditCore, stampFromRequest } from "@/lib/audit";
import { db } from "@/lib/db/client";
import {
  chefs,
  clients,
  invoiceLines,
  invoices,
  shiftHours,
  shifts,
} from "@/lib/db/schema";
import { withTx, type TxConn } from "@/lib/db/tx";
import { recipientsForClient } from "@/lib/domain/client-recipients";
import { computeChefAmountCents } from "@/lib/hours-labels";
import { formatChefRole } from "@/lib/labels";
import { sendEmail } from "@/lib/email";
import { recordEmailMessage } from "@/lib/integrations/email";
import { createNotification } from "@/lib/integrations/notifications";
import { InvoiceKlantEmail } from "@/emails/InvoiceKlantEmail";

/** NL standard BTW rate, in basis points (21%). */
export const VAT_RATE_BPS = 2100;

export type GenerateInvoiceResult =
  | {
      ok: true;
      status: "created";
      invoiceId: string;
      number: string;
      lineCount: number;
      subtotalCents: number;
      vatCents: number;
      totalCents: number;
    }
  | { ok: true; status: "exists"; invoiceId: string; number: string }
  | { ok: true; status: "empty" }
  | { ok: false; error: string };

/** Normalize any Date to UTC midnight — the period/date columns are mode:"date". */
function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Add whole days to a UTC-midnight date. */
function addDays(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

function fmtDateNl(d: Date): string {
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

/** Postgres unique-violation? (only the `number` column can throw one here). */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === "23505") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate key|unique constraint/i.test(msg);
}

/**
 * Next sequential invoice number for a calendar year, e.g. "2026-0007".
 * Reads the current max within the year (zero-padded suffixes sort numerically
 * up to 9999/yr — far beyond any real volume). Computed inside the tx so a retry
 * sees a freshly-committed competitor.
 */
async function computeNextNumber(year: number, conn: TxConn): Promise<string> {
  const prefix = `${year}-`;
  const [row] = await conn
    .select({ maxNum: sql<string | null>`max(${invoices.number})` })
    .from(invoices)
    .where(sql`${invoices.number} like ${prefix + "%"}`);
  let next = 1;
  if (row?.maxNum) {
    const parsed = Number.parseInt(row.maxNum.slice(prefix.length), 10);
    if (Number.isFinite(parsed)) next = parsed + 1;
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
}

/**
 * Generate (or return the existing) invoice for one klant over a period.
 *
 * Bills every admin_approved shift_hours whose shift falls in [periodStart,
 * periodEnd] (inclusive, by shift date) and that isn't already on an invoice.
 * Returns:
 *   - status:"created" — a fresh draft invoice + its lines + audit.
 *   - status:"exists"  — an invoice already covers this exact (client, period).
 *   - status:"empty"   — no billable hours; nothing created.
 */
export async function generateInvoiceForPeriod(args: {
  clientId: string;
  periodStart: Date; // inclusive (work on/after this day)
  periodEnd: Date; // inclusive (work on/before this day)
  actorUserId: string;
  issueDate?: Date; // default today
}): Promise<GenerateInvoiceResult> {
  const periodStart = toDateOnly(args.periodStart);
  const periodEnd = toDateOnly(args.periodEnd);
  const issue = toDateOnly(args.issueDate ?? new Date());

  // Selection window: shifts.startsAt within [periodStart 00:00, periodEnd+1 00:00).
  const windowStart = periodStart;
  const windowEndExclusive = addDays(periodEnd, 1);

  // 1. Idempotency — one LIVE invoice per (client, period); voided ones don't count.
  const existing = await db
    .select({ id: invoices.id, number: invoices.number })
    .from(invoices)
    .where(
      and(
        eq(invoices.clientId, args.clientId),
        eq(invoices.periodStart, periodStart),
        eq(invoices.periodEnd, periodEnd),
        ne(invoices.status, "void"),
      ),
    )
    .limit(1);
  if (existing.length) {
    return { ok: true, status: "exists", invoiceId: existing[0].id, number: existing[0].number };
  }

  // 2. Billing snapshot source.
  const [client] = await db.select().from(clients).where(eq(clients.id, args.clientId)).limit(1);
  if (!client) return { ok: false, error: "client_not_found" };

  // 3. Billable hours: admin_approved, this client, in-period, not yet invoiced.
  const candidates = await db
    .select({
      hoursId: shiftHours.id,
      workedMinutes: shiftHours.workedMinutes,
      clientRateCents: shiftHours.clientRateCents,
      shiftStart: shifts.startsAt,
      roleNeeded: shifts.roleNeeded,
      chefName: chefs.fullName,
    })
    .from(shiftHours)
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .innerJoin(chefs, eq(chefs.id, shiftHours.chefId))
    .leftJoin(invoiceLines, eq(invoiceLines.shiftHoursId, shiftHours.id))
    .where(
      and(
        eq(shiftHours.clientId, args.clientId),
        eq(shiftHours.status, "admin_approved"),
        gte(shifts.startsAt, windowStart),
        lt(shifts.startsAt, windowEndExclusive),
        isNull(invoiceLines.id), // exclude hours already on an invoice
      ),
    )
    .orderBy(shifts.startsAt);

  if (candidates.length === 0) return { ok: true, status: "empty" };

  // 4. Lines + money. Lines are ex-BTW; BTW is added once on the invoice.
  const lineValues = candidates.map((c) => {
    const shiftStart = new Date(c.shiftStart);
    const role = c.roleNeeded ? formatChefRole(c.roleNeeded) : "Chef";
    const amountCents = computeChefAmountCents(c.workedMinutes, c.clientRateCents);
    return {
      shiftHoursId: c.hoursId,
      description: `${c.chefName} — ${role} op ${fmtDateNl(shiftStart)}`,
      chefName: c.chefName,
      shiftDate: toDateOnly(shiftStart),
      workedMinutes: c.workedMinutes,
      rateCents: c.clientRateCents,
      amountCents,
    };
  });
  const subtotalCents = lineValues.reduce((sum, l) => sum + l.amountCents, 0);
  const vatCents = Math.round((subtotalCents * VAT_RATE_BPS) / 10_000);
  const totalCents = subtotalCents + vatCents;

  // 5. Billing snapshot + terms.
  const billToEmail = client.billingEmail ?? client.email ?? null;
  const billToAddress = client.billingAddress ?? client.address ?? null;
  const dueDate = addDays(issue, client.paymentTermsDays ?? 14);

  const auditBase = await stampFromRequest({
    userId: args.actorUserId,
    action: "invoices.generated",
    resource: "invoices",
    after: {
      clientId: args.clientId,
      periodStart: periodStart.toISOString().slice(0, 10),
      periodEnd: periodEnd.toISOString().slice(0, 10),
      lineCount: lineValues.length,
      subtotalCents,
      totalCents,
    },
  });

  // 6. Atomic insert (header + lines + audit). Retry only on a `number` race.
  type TxOut = { kind: "created"; id: string; number: string } | { kind: "raced" };
  let result: TxOut | null = null;
  for (let attempt = 0; attempt < 5 && result === null; attempt++) {
    try {
      result = await withTx<TxOut>(async (tx) => {
        const number = await computeNextNumber(issue.getUTCFullYear(), tx);
        const inserted = await tx
          .insert(invoices)
          .values({
            number,
            clientId: args.clientId,
            status: "draft",
            billToName: client.companyName,
            billToEmail,
            billToAddress,
            billToKvk: client.kvk ?? null,
            billToBtw: client.btw ?? null,
            periodStart,
            periodEnd,
            issueDate: issue,
            dueDate,
            subtotalCents,
            vatRateBps: VAT_RATE_BPS,
            vatCents,
            totalCents,
            createdBy: args.actorUserId,
          })
          // Lost the (client, period) race → 0 rows, NOT a throw. The WHERE
          // matches the PARTIAL unique index (void invoices are excluded).
          .onConflictDoNothing({
            target: [invoices.clientId, invoices.periodStart, invoices.periodEnd],
            where: sql`${invoices.status} <> 'void'`,
          })
          .returning({ id: invoices.id, number: invoices.number });

        if (inserted.length === 0) return { kind: "raced" };

        await tx
          .insert(invoiceLines)
          .values(lineValues.map((l) => ({ ...l, invoiceId: inserted[0].id })));
        await recordAuditCore({ ...auditBase, resourceId: inserted[0].id }, tx);
        return { kind: "created", id: inserted[0].id, number: inserted[0].number };
      });
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 4) continue; // number collision → retry
      throw err;
    }
  }

  if (result === null) return { ok: false, error: "could_not_allocate_number" };

  if (result.kind === "raced") {
    const [winner] = await db
      .select({ id: invoices.id, number: invoices.number })
      .from(invoices)
      .where(
        and(
          eq(invoices.clientId, args.clientId),
          eq(invoices.periodStart, periodStart),
          eq(invoices.periodEnd, periodEnd),
        ),
      )
      .limit(1);
    return winner
      ? { ok: true, status: "exists", invoiceId: winner.id, number: winner.number }
      : { ok: false, error: "race_no_winner" };
  }

  return {
    ok: true,
    status: "created",
    invoiceId: result.id,
    number: result.number,
    lineCount: lineValues.length,
    subtotalCents,
    vatCents,
    totalCents,
  };
}

/**
 * Email an invoice to the klant + flip status draft→sent.
 *
 * Email FIRST, then flip: a financial document is only "sent" once Resend has
 * accepted it (so a failed send leaves the invoice in draft to retry). The send
 * is OUTSIDE the tx (no external call inside a mutation); the status flip + audit
 * are atomic. Re-sending an already-sent invoice re-delivers + bumps sentAt.
 */
export async function sendInvoice(args: {
  invoiceId: string;
  actorUserId: string;
  /** Absolute base URL (e.g. https://app.chefandserve.nl) for the portal CTA. */
  portalBaseUrl?: string;
}): Promise<{ ok: true; recipientCount: number } | { ok: false; error: string }> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, args.invoiceId)).limit(1);
  if (!inv) return { ok: false, error: "not_found" };
  if (inv.status === "paid" || inv.status === "void") return { ok: false, error: "not_sendable" };

  const lines = await db
    .select({ description: invoiceLines.description, amountCents: invoiceLines.amountCents })
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, inv.id))
    .orderBy(invoiceLines.shiftDate);

  const recipients = await recipientsForClient(inv.clientId, "invoice_sent");
  if (recipients.length === 0) return { ok: false, error: "no_recipient" };

  const periodLabel = `${fmtDateNl(new Date(inv.periodStart))} – ${fmtDateNl(new Date(inv.periodEnd))}`;
  const dueLabel = fmtDateNl(new Date(inv.dueDate));
  const vatRateLabel = `${Math.round(inv.vatRateBps / 100)}%`;
  const invoiceUrl = args.portalBaseUrl
    ? `${args.portalBaseUrl.replace(/\/$/, "")}/client/invoices/${inv.id}`
    : undefined;

  const send = await sendEmail({
    to: recipients,
    subject: `Factuur ${inv.number} — te voldoen vóór ${dueLabel}`,
    react: InvoiceKlantEmail({
      recipientName: inv.billToName,
      billToName: inv.billToName,
      invoiceNumber: inv.number,
      periodLabel,
      issueDateLabel: fmtDateNl(new Date(inv.issueDate)),
      dueDateLabel: dueLabel,
      lines: lines.map((l) => ({ description: l.description, amountCents: l.amountCents })),
      subtotalCents: inv.subtotalCents,
      vatCents: inv.vatCents,
      vatRateLabel,
      totalCents: inv.totalCents,
      ...(invoiceUrl ? { invoiceUrl } : {}),
    }),
  });
  if (!send.ok) return { ok: false, error: `email_failed: ${send.error}` };

  const auditBase = await stampFromRequest({
    userId: args.actorUserId,
    action: "invoices.sent",
    resource: "invoices",
    resourceId: inv.id,
    after: { number: inv.number, recipientCount: recipients.length },
  });
  await withTx(async (tx) => {
    const u = await tx
      .update(invoices)
      .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
      .where(and(eq(invoices.id, inv.id), inArray(invoices.status, ["draft", "sent"])))
      .returning({ id: invoices.id });
    if (u.length === 0) return; // concurrently voided/paid — email already out, leave it
    await recordAuditCore(auditBase, tx);
  });

  // Post-commit, best-effort: track each recipient + notify the klant portal user.
  for (const to of recipients) {
    await recordEmailMessage({
      providerMessageId: send.id,
      toEmail: to,
      template: "InvoiceKlantEmail",
      eventKey: "invoice_sent",
      entityType: "invoices",
      entityId: inv.id,
    });
  }
  const [client] = await db
    .select({ userId: clients.userId })
    .from(clients)
    .where(eq(clients.id, inv.clientId))
    .limit(1);
  if (client?.userId) {
    await createNotification({
      userId: client.userId,
      type: "invoice_sent",
      title: `Nieuwe factuur ${inv.number}`,
      body: `Te voldoen vóór ${dueLabel}.`,
      actionUrl: `/client/invoices/${inv.id}`,
      entityType: "invoices",
      entityId: inv.id,
    });
  }

  return { ok: true, recipientCount: recipients.length };
}

/** Mark a sent invoice paid. Atomic: only a 'sent' invoice can become 'paid'. */
export async function markInvoicePaid(args: {
  invoiceId: string;
  actorUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auditBase = await stampFromRequest({
    userId: args.actorUserId,
    action: "invoices.paid",
    resource: "invoices",
    resourceId: args.invoiceId,
  });
  const ok = await withTx(async (tx) => {
    const u = await tx
      .update(invoices)
      .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
      .where(and(eq(invoices.id, args.invoiceId), eq(invoices.status, "sent")))
      .returning({ id: invoices.id });
    if (u.length === 0) return false;
    await recordAuditCore(auditBase, tx);
    return true;
  });
  return ok ? { ok: true } : { ok: false, error: "not_sent_or_already_paid" };
}

/**
 * Void a draft/sent invoice (e.g. wrong period). A PAID invoice can't be voided —
 * issue a credit note instead. Atomic + audited; frees its hours to re-invoice.
 */
export async function voidInvoice(args: {
  invoiceId: string;
  actorUserId: string;
  reason?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auditBase = await stampFromRequest({
    userId: args.actorUserId,
    action: "invoices.voided",
    resource: "invoices",
    resourceId: args.invoiceId,
    after: args.reason ? { reason: args.reason } : undefined,
  });
  const ok = await withTx(async (tx) => {
    const u = await tx
      .update(invoices)
      .set({
        status: "void",
        notes: args.reason ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, args.invoiceId), inArray(invoices.status, ["draft", "sent"])))
      .returning({ id: invoices.id });
    if (u.length === 0) return false;
    // Detach the lines' hours so they can be billed again on a corrected invoice.
    await tx
      .update(invoiceLines)
      .set({ shiftHoursId: null })
      .where(eq(invoiceLines.invoiceId, args.invoiceId));
    await recordAuditCore(auditBase, tx);
    return true;
  });
  return ok ? { ok: true } : { ok: false, error: "not_voidable" };
}
