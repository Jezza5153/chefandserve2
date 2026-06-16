/**
 * CHEF-PR9b — chef vacation + expense REQUESTS (domain).
 *
 * Mirrors clientShiftChangeRequests: the chef asks, Maarten decides. Creation is
 * a chef self-action (ownership IS the lookup — the caller passes the chefId it
 * resolved from session.user.id); decisions are atomic status flips guarded on
 * status='pending' (reject on 0 rows), audited, and notify the chef. The owner is
 * notified on every new request. Free text (note / description) is DATA — trimmed
 * + capped, never interpreted.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  chefExpenseClaims,
  chefVacationRequests,
  chefs,
  users,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { recordAuditFromRequest } from "@/lib/audit";
import { createNotification } from "@/lib/integrations";

const NOTE_MAX = 1000;
const clamp = (s: string | null | undefined): string | null =>
  (s ?? "").trim().slice(0, NOTE_MAX) || null;

/** Resolve the owner's user id (for the new-request notification). */
async function ownerUserId(): Promise<string | null> {
  if (!env.MAARTEN_EMAIL) return null;
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, env.MAARTEN_EMAIL))
    .limit(1);
  return owner?.id ?? null;
}

async function notifyOwnerNewRequest(title: string, body: string, entityId: string): Promise<void> {
  const owner = await ownerUserId();
  if (!owner) return;
  await createNotification({
    userId: owner,
    type: "chef_request",
    title,
    body,
    actionUrl: "/admin/business/chef-requests",
    entityType: "chef_requests",
    entityId,
  }).catch((e) => console.error("[chef-requests] owner notify failed:", e));
}

/* -------------------------------------------------------------------------- */
/* Vacation                                                                    */
/* -------------------------------------------------------------------------- */

export type VacationRequestInput = {
  chefId: string;
  requestedBy: string;
  kind: "payout" | "time_off";
  amountCents?: number | null;
  startDate?: string | null; // YYYY-MM-DD
  endDate?: string | null;
  note?: string | null;
};

export async function createVacationRequest(
  input: VacationRequestInput,
): Promise<{ ok: boolean; id?: string; reason?: string }> {
  // Validate per kind.
  if (input.kind === "payout") {
    const cents = Math.round(input.amountCents ?? 0);
    if (!Number.isFinite(cents) || cents <= 0) return { ok: false, reason: "bad-amount" };
    if (cents > 1_000_000) return { ok: false, reason: "amount-too-large" }; // €10k sanity cap
  } else if (!input.startDate) {
    return { ok: false, reason: "missing-dates" };
  }

  const [row] = await db
    .insert(chefVacationRequests)
    .values({
      chefId: input.chefId,
      requestedBy: input.requestedBy,
      kind: input.kind,
      amountCents: input.kind === "payout" ? Math.round(input.amountCents ?? 0) : null,
      startDate: input.kind === "time_off" ? (input.startDate ?? null) : null,
      endDate: input.kind === "time_off" ? (input.endDate ?? null) : null,
      note: clamp(input.note),
    })
    .returning({ id: chefVacationRequests.id });

  await recordAuditFromRequest({
    userId: input.requestedBy,
    action: "chef_vacation_request.created",
    resource: "chef_vacation_requests",
    resourceId: row.id,
    after: { chefId: input.chefId, kind: input.kind },
  }).catch(() => {});

  const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, input.chefId) });
  await notifyOwnerNewRequest(
    `Vakantieverzoek — ${chef?.fullName ?? "een chef"}`,
    input.kind === "payout" ? "Verzoek om vakantiegeld uit te betalen." : "Verzoek om vrije dagen.",
    row.id,
  );
  return { ok: true, id: row.id };
}

export function listChefVacationRequests(chefId: string) {
  return db
    .select()
    .from(chefVacationRequests)
    .where(eq(chefVacationRequests.chefId, chefId))
    .orderBy(desc(chefVacationRequests.createdAt));
}

export async function decideVacationRequest(args: {
  id: string;
  decidedBy: string;
  decision: "approved" | "rejected";
  decisionNote?: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  // Atomic: only a still-pending request can be decided (reject on 0 rows).
  const updated = await db
    .update(chefVacationRequests)
    .set({
      status: args.decision,
      decidedBy: args.decidedBy,
      decidedAt: new Date(),
      decisionNote: clamp(args.decisionNote),
      updatedAt: new Date(),
    })
    .where(and(eq(chefVacationRequests.id, args.id), eq(chefVacationRequests.status, "pending")))
    .returning({ id: chefVacationRequests.id, chefId: chefVacationRequests.chefId });
  if (updated.length === 0) return { ok: false, reason: "not-pending" };

  await recordAuditFromRequest({
    userId: args.decidedBy,
    action: `chef_vacation_request.${args.decision}`,
    resource: "chef_vacation_requests",
    resourceId: args.id,
    after: { decision: args.decision },
  }).catch(() => {});

  await notifyChefOfDecision(updated[0].chefId, "Vakantieverzoek", args.decision);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Expenses                                                                    */
/* -------------------------------------------------------------------------- */

export type ExpenseClaimInput = {
  chefId: string;
  requestedBy: string;
  category: "reiskosten" | "parkeren" | "ov" | "kilometers" | "overig";
  amountCents: number;
  description?: string | null;
  shiftId?: string | null;
  /** R2 key of an uploaded receipt photo (optional). */
  receiptR2Key?: string | null;
};

export async function createExpenseClaim(
  input: ExpenseClaimInput,
): Promise<{ ok: boolean; id?: string; reason?: string }> {
  const cents = Math.round(input.amountCents ?? 0);
  if (!Number.isFinite(cents) || cents <= 0) return { ok: false, reason: "bad-amount" };
  if (cents > 500_000) return { ok: false, reason: "amount-too-large" }; // €5k sanity cap

  const [row] = await db
    .insert(chefExpenseClaims)
    .values({
      chefId: input.chefId,
      requestedBy: input.requestedBy,
      category: input.category,
      amountCents: cents,
      description: clamp(input.description),
      shiftId: input.shiftId ?? null,
      receiptR2Key: input.receiptR2Key ?? null,
    })
    .returning({ id: chefExpenseClaims.id });

  await recordAuditFromRequest({
    userId: input.requestedBy,
    action: "chef_expense_claim.created",
    resource: "chef_expense_claims",
    resourceId: row.id,
    after: { chefId: input.chefId, category: input.category, amountCents: cents },
  }).catch(() => {});

  const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, input.chefId) });
  await notifyOwnerNewRequest(
    `Onkostendeclaratie — ${chef?.fullName ?? "een chef"}`,
    `${input.category} · €${(cents / 100).toFixed(2)}`,
    row.id,
  );
  return { ok: true, id: row.id };
}

export function listChefExpenseClaims(chefId: string) {
  return db
    .select()
    .from(chefExpenseClaims)
    .where(eq(chefExpenseClaims.chefId, chefId))
    .orderBy(desc(chefExpenseClaims.createdAt));
}

export async function decideExpenseClaim(args: {
  id: string;
  decidedBy: string;
  decision: "approved" | "rejected";
  decisionNote?: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  const updated = await db
    .update(chefExpenseClaims)
    .set({
      status: args.decision,
      decidedBy: args.decidedBy,
      decidedAt: new Date(),
      decisionNote: clamp(args.decisionNote),
      updatedAt: new Date(),
    })
    .where(and(eq(chefExpenseClaims.id, args.id), eq(chefExpenseClaims.status, "pending")))
    .returning({ id: chefExpenseClaims.id, chefId: chefExpenseClaims.chefId });
  if (updated.length === 0) return { ok: false, reason: "not-pending" };

  await recordAuditFromRequest({
    userId: args.decidedBy,
    action: `chef_expense_claim.${args.decision}`,
    resource: "chef_expense_claims",
    resourceId: args.id,
    after: { decision: args.decision },
  }).catch(() => {});

  await notifyChefOfDecision(updated[0].chefId, "Onkostendeclaratie", args.decision);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

async function notifyChefOfDecision(
  chefId: string,
  label: string,
  decision: "approved" | "rejected",
): Promise<void> {
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, chefId) });
  if (!chef?.userId) return;
  await createNotification({
    userId: chef.userId,
    type: "chef_request_decision",
    title: `${label} ${decision === "approved" ? "goedgekeurd" : "afgewezen"}`,
    body:
      decision === "approved"
        ? "Het kantoor heeft je verzoek goedgekeurd."
        : "Het kantoor heeft je verzoek afgewezen — neem contact op bij vragen.",
    actionUrl: "/chef/declaraties",
    entityType: "chef_requests",
    entityId: chefId,
  }).catch((e) => console.error("[chef-requests] chef notify failed:", e));
}

/** Admin: all pending requests across chefs (for /admin/business/chef-requests). */
export async function listPendingChefRequests(): Promise<{
  vacation: Array<{ id: string; chefName: string; kind: string; amountCents: number | null; startDate: string | null; endDate: string | null; note: string | null; createdAt: Date }>;
  expenses: Array<{ id: string; chefName: string; category: string; amountCents: number; description: string | null; receiptR2Key: string | null; createdAt: Date }>;
}> {
  const vac = await db
    .select({
      id: chefVacationRequests.id,
      chefName: chefs.fullName,
      kind: chefVacationRequests.kind,
      amountCents: chefVacationRequests.amountCents,
      startDate: chefVacationRequests.startDate,
      endDate: chefVacationRequests.endDate,
      note: chefVacationRequests.note,
      createdAt: chefVacationRequests.createdAt,
    })
    .from(chefVacationRequests)
    .innerJoin(chefs, eq(chefs.id, chefVacationRequests.chefId))
    .where(eq(chefVacationRequests.status, "pending"))
    .orderBy(desc(chefVacationRequests.createdAt));

  const exp = await db
    .select({
      id: chefExpenseClaims.id,
      chefName: chefs.fullName,
      category: chefExpenseClaims.category,
      amountCents: chefExpenseClaims.amountCents,
      description: chefExpenseClaims.description,
      receiptR2Key: chefExpenseClaims.receiptR2Key,
      createdAt: chefExpenseClaims.createdAt,
    })
    .from(chefExpenseClaims)
    .innerJoin(chefs, eq(chefs.id, chefExpenseClaims.chefId))
    .where(eq(chefExpenseClaims.status, "pending"))
    .orderBy(desc(chefExpenseClaims.createdAt));

  return { vacation: vac, expenses: exp };
}
