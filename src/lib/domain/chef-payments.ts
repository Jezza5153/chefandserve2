/**
 * CHEF-PR9a — chef payment status + vacation estimate (read-only).
 *
 * Two questions every chef asks: "wanneer word ik betaald?" and "hoeveel
 * vakantiegeld heb ik opgebouwd?". Both are derived from the hours trust chain
 * (shiftHours), so there is NO new table and NO mutation — auth IS the lookup.
 *
 * Payment status walks the same state machine the UI already labels
 * (humanStatus / humanNextAction), collapsed into a payout pipeline so the chef
 * sees where each shift's money is. Amounts are the chef's own snapshot rate ×
 * worked minutes (the same computeChefAmountCents the hours form uses) — an
 * INDICATIE, never a loonstrook (the office + payroll confirm the final number).
 *
 * Vacation is an ESTIMATE: vakantiegeld accrues on the gross of finalised hours
 * (admin_approved + exported) at MONEY_ASSUMPTIONS.vacationPct. We don't track
 * payouts yet (no requests table in v1), so it's framed as "opgebouwd, schatting
 * tot payroll bevestigt" — same honesty rule as the Money Explainer.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, shiftHours, shifts } from "@/lib/db/schema";
import { computeChefAmountCents } from "@/lib/hours-labels";
import { MONEY_ASSUMPTIONS } from "@/lib/money";

/** The payout pipeline buckets, in chain order. */
export type PaymentStage =
  | "to_submit" // draft — chef still owes their hours
  | "awaiting_client" // submitted — waiting on klant signature
  | "awaiting_office" // client_signed — waiting on Chef & Serve approval
  | "approved" // admin_approved — green-lit, not yet exported
  | "paid_out" // exported — handed to payroll
  | "rejected"; // client_rejected / admin_rejected — needs a fix

export type PaymentLine = {
  placementId: string;
  shiftId: string;
  company: string | null;
  startsAt: Date;
  workedMinutes: number;
  amountCents: number;
  stage: PaymentStage;
};

export type PaymentBucket = {
  stage: PaymentStage;
  label: string;
  /** "wat gebeurt er nu?" next-step line. */
  nextStep: string;
  count: number;
  amountCents: number;
  lines: PaymentLine[];
};

export type ChefPaymentStatus = {
  buckets: PaymentBucket[];
  /** Money still on its way to the chef (everything except paid_out + rejected). */
  inFlightCents: number;
  paidOutCents: number;
};

const STAGE_META: Record<PaymentStage, { label: string; nextStep: string; order: number }> = {
  to_submit: {
    label: "Nog in te dienen",
    nextStep: "Dien je uren in zodat de klant kan tekenen.",
    order: 0,
  },
  awaiting_client: {
    label: "Wacht op handtekening klant",
    nextStep: "De klant moet je uren tekenen. Duurt het lang? Het kantoor stuurt een herinnering.",
    order: 1,
  },
  awaiting_office: {
    label: "Wacht op goedkeuring kantoor",
    nextStep: "Chef & Serve controleert en keurt de getekende uren goed.",
    order: 2,
  },
  approved: {
    label: "Goedgekeurd — wordt uitbetaald",
    nextStep: "Je uren zijn goedgekeurd en gaan mee in de eerstvolgende payroll-run.",
    order: 3,
  },
  paid_out: {
    label: "Doorgezet voor uitbetaling",
    nextStep: "Doorgegeven aan payroll. De uitbetaaldatum hangt af van de loonrun.",
    order: 4,
  },
  rejected: {
    label: "Teruggezet — actie nodig",
    nextStep: "Er klopte iets niet. Pas je uren aan of neem contact op met het kantoor.",
    order: 5,
  },
};

function stageOf(status: string): PaymentStage | null {
  switch (status) {
    case "draft":
      return "to_submit";
    case "submitted":
      return "awaiting_client";
    case "client_signed":
      return "awaiting_office";
    case "admin_approved":
      return "approved";
    case "exported":
      return "paid_out";
    case "client_rejected":
    case "admin_rejected":
      return "rejected";
    case "void":
    default:
      return null; // void / unknown → not part of the payout view
  }
}

/**
 * The chef's payout pipeline: every non-void hours row bucketed by where its
 * money is in the chain, newest shift first within each bucket.
 */
export async function getChefPaymentStatus(chefId: string): Promise<ChefPaymentStatus> {
  const rows = await db
    .select({
      placementId: shiftHours.placementId,
      shiftId: shiftHours.shiftId,
      status: shiftHours.status,
      workedMinutes: shiftHours.workedMinutes,
      chefRateCents: shiftHours.chefRateCents,
      company: clients.companyName,
      startsAt: shifts.startsAt,
    })
    .from(shiftHours)
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .leftJoin(clients, eq(clients.id, shiftHours.clientId))
    .where(eq(shiftHours.chefId, chefId));

  const byStage = new Map<PaymentStage, PaymentLine[]>();
  let inFlightCents = 0;
  let paidOutCents = 0;

  for (const r of rows) {
    const stage = stageOf(r.status);
    if (!stage) continue;
    const amountCents = computeChefAmountCents(r.workedMinutes ?? 0, r.chefRateCents ?? 0);
    const line: PaymentLine = {
      placementId: r.placementId,
      shiftId: r.shiftId,
      company: r.company,
      startsAt: r.startsAt,
      workedMinutes: r.workedMinutes ?? 0,
      amountCents,
      stage,
    };
    const arr = byStage.get(stage) ?? [];
    arr.push(line);
    byStage.set(stage, arr);

    if (stage === "paid_out") paidOutCents += amountCents;
    else if (stage !== "rejected") inFlightCents += amountCents;
  }

  const buckets: PaymentBucket[] = [...byStage.entries()]
    .map(([stage, lines]) => {
      lines.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
      return {
        stage,
        label: STAGE_META[stage].label,
        nextStep: STAGE_META[stage].nextStep,
        count: lines.length,
        amountCents: lines.reduce((s, l) => s + l.amountCents, 0),
        lines,
      };
    })
    .sort((a, b) => STAGE_META[a.stage].order - STAGE_META[b.stage].order);

  return { buckets, inFlightCents, paidOutCents };
}

export type ChefVacationEstimate = {
  /** Gross basis = chef pay from finalised hours (admin_approved + exported). */
  basisCents: number;
  pct: number;
  /** Estimated vakantiegeld accrued = basis × pct. */
  accruedCents: number;
  assumptionsUpdated: string;
};

/**
 * Estimated vakantiegeld accrued, derived from the gross of finalised hours.
 * INDICATIE only — payroll holds the real ledger. No payouts subtracted in v1.
 */
export async function getChefVacationEstimate(chefId: string): Promise<ChefVacationEstimate> {
  const rows = await db
    .select({
      workedMinutes: shiftHours.workedMinutes,
      chefRateCents: shiftHours.chefRateCents,
    })
    .from(shiftHours)
    .where(
      and(
        eq(shiftHours.chefId, chefId),
        inArray(shiftHours.status, ["admin_approved", "exported"]),
      ),
    );

  const basisCents = rows.reduce(
    (s, r) => s + computeChefAmountCents(r.workedMinutes ?? 0, r.chefRateCents ?? 0),
    0,
  );
  const pct = MONEY_ASSUMPTIONS.vacationPct;
  return {
    basisCents,
    pct,
    accruedCents: Math.round(basisCents * (pct / 100)),
    assumptionsUpdated: MONEY_ASSUMPTIONS.lastUpdated,
  };
}
