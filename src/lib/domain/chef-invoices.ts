/**
 * CHEF-PR7 — ZZP self-billing domain. A freelance chef invoices Chef & Serve for
 * shifts worked (chef → agency). Distinct from the invoicing chat's klant-billing.
 *
 * Lifecycle: concept → submitted → approved → paid (or rejected). Atomic guarded
 * transitions (UPDATE … WHERE status='<expected>'). Ownership IS the lookup — the
 * caller passes the session-resolved chefId. Owner notified on submit; chef
 * notified on every decision. Amounts are the chef's claim; finance confirms.
 */
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefInvoices, chefs, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { recordAuditFromRequest } from "@/lib/audit";
import { createNotification } from "@/lib/integrations";

export type ChefInvoiceStatus = "concept" | "submitted" | "approved" | "paid" | "rejected";

const clamp = (s: string | null | undefined, n = 500): string | null =>
  (s ?? "").trim().slice(0, n) || null;

async function ownerUserId(): Promise<string | null> {
  if (!env.MAARTEN_EMAIL) return null;
  const [o] = await db.select({ id: users.id }).from(users).where(eq(users.email, env.MAARTEN_EMAIL)).limit(1);
  return o?.id ?? null;
}

export type CreateChefInvoiceInput = {
  chefId: string;
  actorUserId: string;
  amountCents: number;
  periodFrom?: string | null; // YYYY-MM-DD
  periodTo?: string | null;
  reference?: string | null;
  note?: string | null;
  invoiceR2Key?: string | null;
  /** true → status 'submitted' (sent to office); false → 'concept' (saved draft). */
  submit: boolean;
};

export async function createChefInvoice(
  input: CreateChefInvoiceInput,
): Promise<{ ok: boolean; id?: string; reason?: string }> {
  const cents = Math.round(input.amountCents ?? 0);
  if (!Number.isFinite(cents) || cents <= 0) return { ok: false, reason: "bad-amount" };
  if (cents > 5_000_000) return { ok: false, reason: "amount-too-large" }; // €50k sanity cap

  const now = new Date();
  const [row] = await db
    .insert(chefInvoices)
    .values({
      chefId: input.chefId,
      status: input.submit ? "submitted" : "concept",
      amountCents: cents,
      periodFrom: input.periodFrom ?? null,
      periodTo: input.periodTo ?? null,
      reference: clamp(input.reference, 120),
      note: clamp(input.note),
      invoiceR2Key:
        input.invoiceR2Key && input.invoiceR2Key.startsWith(`chefs/${input.chefId}/invoices/`)
          ? input.invoiceR2Key
          : null,
      submittedAt: input.submit ? now : null,
    })
    .returning({ id: chefInvoices.id });

  await recordAuditFromRequest({
    userId: input.actorUserId,
    action: input.submit ? "chef_invoice.submitted" : "chef_invoice.concept_created",
    resource: "chef_invoices",
    resourceId: row.id,
    after: { chefId: input.chefId, amountCents: cents },
  }).catch(() => {});

  if (input.submit) {
    const owner = await ownerUserId();
    const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, input.chefId) });
    if (owner) {
      await createNotification({
        userId: owner,
        type: "chef_invoice",
        title: `Factuur ontvangen — ${chef?.fullName ?? "een ZZP-chef"}`,
        body: `€${(cents / 100).toFixed(2)} ingediend ter goedkeuring.`,
        actionUrl: "/admin/business/chef-invoices",
        entityType: "chef_invoices",
        entityId: row.id,
      }).catch(() => {});
    }
  }
  return { ok: true, id: row.id };
}

export function listChefInvoices(chefId: string) {
  return db
    .select()
    .from(chefInvoices)
    .where(eq(chefInvoices.chefId, chefId))
    .orderBy(desc(chefInvoices.createdAt));
}

/** Submit a previously-saved concept (atomic: only from 'concept'). */
export async function submitChefInvoice(args: {
  id: string;
  chefId: string;
  actorUserId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const updated = await db
    .update(chefInvoices)
    .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(chefInvoices.id, args.id),
        eq(chefInvoices.chefId, args.chefId), // ownership
        eq(chefInvoices.status, "concept"),
      ),
    )
    .returning({ id: chefInvoices.id });
  if (updated.length === 0) return { ok: false, reason: "not-concept-or-not-owned" };
  await recordAuditFromRequest({
    userId: args.actorUserId,
    action: "chef_invoice.submitted",
    resource: "chef_invoices",
    resourceId: args.id,
  }).catch(() => {});
  const owner = await ownerUserId();
  if (owner) {
    await createNotification({
      userId: owner,
      type: "chef_invoice",
      title: "Factuur ingediend",
      body: "Een ZZP-chef heeft een factuur ingediend ter goedkeuring.",
      actionUrl: "/admin/business/chef-invoices",
      entityType: "chef_invoices",
      entityId: args.id,
    }).catch(() => {});
  }
  return { ok: true };
}

/** Office decision (approve / reject / mark paid). Atomic guarded transitions. */
export async function decideChefInvoice(args: {
  id: string;
  decidedBy: string;
  decision: "approved" | "rejected" | "paid";
  decisionNote?: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  // approve/reject only from 'submitted'; paid only from 'approved'.
  const from: ChefInvoiceStatus[] = args.decision === "paid" ? ["approved"] : ["submitted"];
  const now = new Date();
  const updated = await db
    .update(chefInvoices)
    .set({
      status: args.decision,
      decidedBy: args.decidedBy,
      decidedAt: now,
      decisionNote: clamp(args.decisionNote),
      paidAt: args.decision === "paid" ? now : undefined,
      updatedAt: now,
    })
    .where(and(eq(chefInvoices.id, args.id), inArray(chefInvoices.status, from)))
    .returning({ id: chefInvoices.id, chefId: chefInvoices.chefId });
  if (updated.length === 0) return { ok: false, reason: "wrong-state" };

  await recordAuditFromRequest({
    userId: args.decidedBy,
    action: `chef_invoice.${args.decision}`,
    resource: "chef_invoices",
    resourceId: args.id,
    after: { decision: args.decision },
  }).catch(() => {});

  const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, updated[0].chefId) });
  if (chef?.userId) {
    const label =
      args.decision === "approved"
        ? "goedgekeurd"
        : args.decision === "paid"
          ? "betaald"
          : "afgewezen";
    await createNotification({
      userId: chef.userId,
      type: "chef_invoice_decision",
      title: `Je factuur is ${label}`,
      body:
        args.decision === "rejected"
          ? "Het kantoor heeft je factuur afgewezen — bekijk de opmerking."
          : `Het kantoor heeft je factuur ${label}.`,
      actionUrl: "/chef/facturen",
      entityType: "chef_invoices",
      entityId: args.id,
    }).catch(() => {});
  }
  return { ok: true };
}

/** Admin: invoices awaiting action (submitted + approved-but-unpaid). */
export async function listPendingChefInvoices(): Promise<
  Array<{ id: string; chefName: string; status: string; amountCents: number; periodFrom: string | null; periodTo: string | null; reference: string | null; invoiceR2Key: string | null; submittedAt: Date | null }>
> {
  return db
    .select({
      id: chefInvoices.id,
      chefName: chefs.fullName,
      status: chefInvoices.status,
      amountCents: chefInvoices.amountCents,
      periodFrom: chefInvoices.periodFrom,
      periodTo: chefInvoices.periodTo,
      reference: chefInvoices.reference,
      invoiceR2Key: chefInvoices.invoiceR2Key,
      submittedAt: chefInvoices.submittedAt,
    })
    .from(chefInvoices)
    .innerJoin(chefs, eq(chefs.id, chefInvoices.chefId))
    .where(inArray(chefInvoices.status, ["submitted", "approved"]))
    .orderBy(desc(chefInvoices.submittedAt));
}
