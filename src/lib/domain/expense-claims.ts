/**
 * Approved expense claims: paying the chef AND passing the cost on to the klant.
 *
 * A declaration could be submitted and approved, and then it ceased to exist. The amount
 * appeared in no payroll batch, no CSV, no invoice line and no owner view — only in the
 * audit log. So travel costs were settled by hand outside the system, and any mark-up on
 * them was margin nobody could see.
 *
 * Two directions, deliberately independent:
 *
 *  - OUT to the chef. An approved claim becomes a payroll line. That is why
 *    `payroll_batch_lines.shift_hours_id` gave up its NOT NULL: a payroll line is no
 *    longer always an hours line, and leaving it required is precisely what kept
 *    declarations out of payroll.
 *  - IN from the klant, but only when a sell amount is set. Passing a cost on is a
 *    decision, not an automatism — some costs we absorb. `sellAmountCents` stays NULL
 *    until someone says otherwise, and the difference with `amountCents` is the margin.
 *
 * `invoiceLineId` is the guard against billing the same receipt twice.
 */
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefExpenseClaims, chefs, clients, invoiceLines, shifts } from "@/lib/db/schema";
import { recordAuditFromRequest } from "@/lib/audit";
import { getMoneyAssumptions } from "@/lib/business-settings";

export type DeclaratieResultaat = { ok: true } | { ok: false; error: string };

/**
 * Approve a claim, decide what the klant pays, and link it to the klant it belongs to.
 *
 * `sellAmountCents` null = we absorb this cost. Passing it on is never the default: an
 * automatic mark-up on someone's parking ticket is the kind of surprise that costs a klant
 * relationship more than the ticket was worth.
 */
export async function approveExpenseClaim(args: {
  claimId: string;
  approverUserId: string;
  sellAmountCents?: number | null;
  decisionNote?: string;
}): Promise<DeclaratieResultaat> {
  const [claim] = (await db
    .select({
      id: chefExpenseClaims.id,
      status: chefExpenseClaims.status,
      amountCents: chefExpenseClaims.amountCents,
      shiftId: chefExpenseClaims.shiftId,
      clientId: chefExpenseClaims.clientId,
    })
    .from(chefExpenseClaims)
    .where(eq(chefExpenseClaims.id, args.claimId))
    .limit(1)) as { id: string; status: string; amountCents: number; shiftId: string | null; clientId: string | null }[];
  if (!claim) return { ok: false, error: "Deze declaratie bestaat niet (meer)." };
  if (claim.status !== "pending") return { ok: false, error: "Deze declaratie is al beoordeeld." };

  const verkoop = args.sellAmountCents ?? null;
  if (verkoop != null && verkoop < 0) return { ok: false, error: "Een doorbelasting kan niet negatief zijn." };

  // Which klant carries it: whatever is already set, otherwise the shift's klant.
  let clientId = claim.clientId;
  if (!clientId && claim.shiftId) {
    const [s] = (await db.select({ clientId: shifts.clientId }).from(shifts).where(eq(shifts.id, claim.shiftId)).limit(1)) as { clientId: string }[];
    clientId = s?.clientId ?? null;
  }
  if (verkoop != null && !clientId) {
    return { ok: false, error: "Doorbelasten kan niet: er hangt geen klant aan deze declaratie." };
  }

  // Atomic on the status, so two approvals cannot both go through.
  const bijgewerkt = await db
    .update(chefExpenseClaims)
    .set({
      status: "approved",
      decidedAt: new Date(),
      decidedBy: args.approverUserId,
      ...(args.decisionNote ? { decisionNote: args.decisionNote } : {}),
      sellAmountCents: verkoop,
      clientId,
      updatedAt: new Date(),
    })
    .where(and(eq(chefExpenseClaims.id, args.claimId), eq(chefExpenseClaims.status, "pending")))
    .returning({ id: chefExpenseClaims.id });
  if (bijgewerkt.length === 0) return { ok: false, error: "Deze declaratie is inmiddels door iemand anders beoordeeld." };

  await recordAuditFromRequest({
    userId: args.approverUserId,
    action: "chef_expense_claims.approved",
    resource: "chef_expense_claims",
    resourceId: args.claimId,
    after: { amountCents: claim.amountCents, sellAmountCents: verkoop, clientId },
  }).catch(() => {});
  return { ok: true };
}

export type DoorTeBelastenDeclaratie = {
  id: string;
  chefNaam: string;
  categorie: string;
  omschrijving: string | null;
  sellAmountCents: number;
  kostprijsCents: number;
};

/**
 * Approved claims for this klant that carry a sell amount and are not on an invoice yet.
 *
 * Called by invoice generation, so a cost that was approved during the period lands on the
 * same invoice as the hours it belongs to.
 */
export async function getDoorTeBelastenDeclaraties(clientId: string): Promise<DoorTeBelastenDeclaratie[]> {
  const rows = (await db
    .select({
      id: chefExpenseClaims.id,
      chefNaam: chefs.fullName,
      categorie: chefExpenseClaims.category,
      omschrijving: chefExpenseClaims.description,
      sellAmountCents: chefExpenseClaims.sellAmountCents,
      kostprijsCents: chefExpenseClaims.amountCents,
    })
    .from(chefExpenseClaims)
    .innerJoin(chefs, eq(chefs.id, chefExpenseClaims.chefId))
    .where(
      and(
        eq(chefExpenseClaims.clientId, clientId),
        eq(chefExpenseClaims.status, "approved"),
        isNotNull(chefExpenseClaims.sellAmountCents),
        isNull(chefExpenseClaims.invoiceLineId),
      ),
    )) as DoorTeBelastenDeclaratie[];
  return rows.filter((r) => r.sellAmountCents > 0);
}

/** Mark a claim as billed. Called right after its invoice line exists. */
export async function markeerDeclaratieGefactureerd(claimId: string, invoiceLineId: string): Promise<void> {
  await db
    .update(chefExpenseClaims)
    .set({ invoiceLineId, updatedAt: new Date() })
    .where(and(eq(chefExpenseClaims.id, claimId), isNull(chefExpenseClaims.invoiceLineId)));
}

export type DeclaratieOverzicht = {
  openstaand: number;
  goedgekeurdNietDoorbelast: number;
  goedgekeurdNietUitbetaald: number;
  margeCents: number;
};

/** What is stuck where — the numbers an owner surface needs. */
export async function getDeclaratieOverzicht(): Promise<DeclaratieOverzicht> {
  const [r] = (await db
    .select({
      openstaand: sql<number>`count(*) filter (where ${chefExpenseClaims.status} = 'pending')::int`,
      nietDoorbelast: sql<number>`count(*) filter (where ${chefExpenseClaims.status} = 'approved' and ${chefExpenseClaims.sellAmountCents} is null)::int`,
      nietGefactureerd: sql<number>`count(*) filter (where ${chefExpenseClaims.status} = 'approved' and ${chefExpenseClaims.sellAmountCents} is not null and ${chefExpenseClaims.invoiceLineId} is null)::int`,
      marge: sql<number>`coalesce(sum(coalesce(${chefExpenseClaims.sellAmountCents}, 0) - ${chefExpenseClaims.amountCents}) filter (where ${chefExpenseClaims.status} = 'approved' and ${chefExpenseClaims.sellAmountCents} is not null), 0)::int`,
    })
    .from(chefExpenseClaims)) as { openstaand: number; nietDoorbelast: number; nietGefactureerd: number; marge: number }[];
  return {
    openstaand: r?.openstaand ?? 0,
    goedgekeurdNietDoorbelast: r?.nietDoorbelast ?? 0,
    goedgekeurdNietUitbetaald: r?.nietGefactureerd ?? 0,
    margeCents: r?.marge ?? 0,
  };
}

/**
 * A default sell amount for a cost, from the money assumptions.
 *
 * Only ever a SUGGESTION shown next to the field — the approver types the real number.
 * Marking up someone's receipt automatically is exactly the decision a person should make.
 */
export async function voorgesteldeDoorbelasting(kostprijsCents: number): Promise<number> {
  const aannames = await getMoneyAssumptions();
  const opslagPct = Number((aannames as Record<string, unknown>).expenseMarkupPct ?? 0);
  if (!Number.isFinite(opslagPct) || opslagPct <= 0) return kostprijsCents;
  return Math.round(kostprijsCents * (1 + opslagPct / 100));
}

/** Names for the UI. */
export const CATEGORIE_LABEL: Record<string, string> = {
  reiskosten: "reiskosten",
  parkeren: "parkeerkosten",
  ov: "openbaar vervoer",
  kilometers: "kilometervergoeding",
  overig: "overige kosten",
};

export async function klantNaam(clientId: string): Promise<string | null> {
  const [r] = (await db.select({ naam: clients.companyName }).from(clients).where(eq(clients.id, clientId)).limit(1)) as { naam: string }[];
  return r?.naam ?? null;
}

/** Guard used by the smoke: an invoice line that a claim points at must really exist. */
export async function declaratieFactuurregelBestaat(claimId: string): Promise<boolean> {
  const [r] = (await db
    .select({ id: invoiceLines.id })
    .from(chefExpenseClaims)
    .innerJoin(invoiceLines, eq(invoiceLines.id, chefExpenseClaims.invoiceLineId))
    .where(eq(chefExpenseClaims.id, claimId))
    .limit(1)) as { id: string }[];
  return !!r;
}
