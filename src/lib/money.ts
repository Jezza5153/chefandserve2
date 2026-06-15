/**
 * CHEF-PR8 — Money Explainer (bruto/netto/ZZP). INDICATIE ONLY — geen loonstrook,
 * geen belastingadvies. Net pay depends on personal situation, tax credits, multiple
 * jobs, pension, payroll provider, cao, year, and the exact loonheffing tables, so
 * this is a COARSE, owner-tunable estimate — NOT a payslip.
 *
 * Assumptions are surfaced + owner-tunable (MONEY_ASSUMPTIONS) and cite official
 * sources (Rijksoverheid minimumloon/vakantiegeld · Belastingdienst Handboek
 * Loonheffingen · KHN Horeca-cao). Verify against current official tables before
 * flipping MONEY_EXPLAINER_ENABLED. Pure + deterministic. Safe to import client-side.
 */

export type MoneyAssumptions = {
  /** Statutory minimum hourly wage (€), age 21+ — Rijksoverheid. */
  minimumWageHour: number;
  /** Vacation pay as % of gross — Rijksoverheid (≥8%). */
  vacationPct: number;
  /** COARSE effective loonheffing % for a payroll NET indicatie. NOT a tax table. */
  payrollEffectiveTaxPct: number;
  /** Rough extra % withheld when no loonheffingskorting is applied. */
  noKortingExtraPct: number;
  /** ZZP: % of ex-VAT income to reserve for inkomstenbelasting (rough). */
  zzpIncomeTaxReservePct: number;
  /** ZZP: Zvw-bijdrage % (rough). */
  zzpZvwPct: number;
  /** VAT % (btw) on zzp invoices — collected for the Belastingdienst, NOT income. */
  vatPct: number;
  /** When the owner last verified these against official tables. */
  lastUpdated: string;
  source: string;
};

/**
 * DEFAULT assumptions — INDICATIE placeholders the owner must verify/tune against the
 * current official tables before go-live. The effective-tax percentages are coarse
 * approximations for a ballpark net, NOT the Belastingdienst loontabellen.
 */
export const MONEY_ASSUMPTIONS: MoneyAssumptions = {
  minimumWageHour: 14.99, // from 2026-07-01, age 21+ (Rijksoverheid)
  vacationPct: 8,
  payrollEffectiveTaxPct: 25, // INDICATIE — tune to current loontabellen
  noKortingExtraPct: 8,
  zzpIncomeTaxReservePct: 30,
  zzpZvwPct: 5.26,
  vatPct: 21,
  lastUpdated: "2026-06-15",
  source:
    "Rijksoverheid minimumloon/vakantiegeld · Belastingdienst Handboek Loonheffingen · KHN Horeca-cao 2025–2026. INDICATIE — verifieer tegen actuele tabellen.",
};

const toCents = (eur: number): number => Math.round(eur * 100);

/** €X,XX from cents (Dutch). Pure — no server deps, safe in client components. */
export function eur(cents: number): string {
  return `€${(cents / 100).toFixed(2).replace(".", ",")}`;
}

export type PayrollEstimate = {
  grossCents: number;
  vacationCents: number; // vakantiegeld-opbouw
  netEstimateCents: number; // indicatie
  effectiveTaxPct: number;
};

export function estimatePayroll(args: {
  grossHourly: number;
  hours: number;
  loonheffingskorting: boolean;
  a?: MoneyAssumptions;
}): PayrollEstimate {
  const A = args.a ?? MONEY_ASSUMPTIONS;
  const grossCents = toCents(Math.max(0, args.grossHourly) * Math.max(0, args.hours));
  const vacationCents = Math.round(grossCents * (A.vacationPct / 100));
  const taxPct = Math.min(
    90,
    A.payrollEffectiveTaxPct + (args.loonheffingskorting ? 0 : A.noKortingExtraPct),
  );
  const netEstimateCents = Math.round(grossCents * (1 - taxPct / 100));
  return { grossCents, vacationCents, netEstimateCents, effectiveTaxPct: taxPct };
}

export type ZzpEstimate = {
  grossExVatCents: number; // wat je factureert (excl. btw)
  vatCents: number; // btw — NIET jouw geld
  incomeTaxReserveCents: number;
  zvwReserveCents: number;
  keepEstimateCents: number; // ruwe schatting wat je overhoudt
};

export function estimateZzp(args: {
  hourly: number;
  hours: number;
  a?: MoneyAssumptions;
}): ZzpEstimate {
  const A = args.a ?? MONEY_ASSUMPTIONS;
  const grossExVatCents = toCents(Math.max(0, args.hourly) * Math.max(0, args.hours));
  const vatCents = Math.round(grossExVatCents * (A.vatPct / 100));
  const incomeTaxReserveCents = Math.round(grossExVatCents * (A.zzpIncomeTaxReservePct / 100));
  const zvwReserveCents = Math.round(grossExVatCents * (A.zzpZvwPct / 100));
  const keepEstimateCents = grossExVatCents - incomeTaxReserveCents - zvwReserveCents;
  return { grossExVatCents, vatCents, incomeTaxReserveCents, zvwReserveCents, keepEstimateCents };
}
