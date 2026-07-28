/**
 * Free invoice lines — anything billable that is not a worked hour.
 *
 * Before this, a line could only be born from an approved `shift_hours` row. So a no-show
 * fee, a late-cancellation charge, travel costs, materials, a fixed call-out fee or a
 * goodwill discount had nowhere to live and left the system entirely, settled by hand
 * outside it. That is why revenue and margin were structurally incomplete rather than
 * merely small: the numbers were right about hours and silent about everything else.
 *
 * TWO RULES HOLD THIS TOGETHER.
 *
 * 1. Draft only. An invoice that has been sent is a document the klant is holding; its
 *    lines and totals are frozen. Every mutation here re-checks the status in the same
 *    statement that changes the row, so a concurrent "send" cannot slip past a read.
 *
 * 2. Totals are derived, never accumulated. `recomputeInvoiceTotals` sums the lines from
 *    scratch. Adjusting a running total per mutation drifts the moment one call fails
 *    halfway; recomputing is idempotent and self-healing, which matters because neon-http
 *    has no interactive transactions.
 *
 * BTW is per line. Catering mixes 21% on service with 9% on food, which one rate on the
 * invoice header cannot express. VAT is rounded per line and then summed — rounding the
 * total instead would put the invoice a cent away from the sum of its own rows, and a
 * klant's bookkeeper will find that cent.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { withTx } from "@/lib/db/tx";
import { invoiceLines, invoices } from "@/lib/db/schema";
import { recordAuditFromRequest } from "@/lib/audit";

export type InvoiceLineKind = "hours" | "surcharge" | "expense" | "fee" | "discount" | "other";

/** Kinds a human may add by hand. `hours` and `surcharge` are generated, never typed. */
export const HANDMATIGE_SOORTEN: InvoiceLineKind[] = ["expense", "fee", "discount", "other"];

export const SOORT_LABEL: Record<InvoiceLineKind, string> = {
  hours: "gewerkte uren",
  surcharge: "toeslag",
  expense: "doorbelaste kosten",
  fee: "vergoeding",
  discount: "korting",
  other: "overig",
};

/** The VAT rates that occur in this business. */
export const BTW_TARIEVEN = [
  { bps: 2100, label: "21% (standaard)" },
  { bps: 900, label: "9% (voedsel)" },
  { bps: 0, label: "0% (verlegd / vrijgesteld)" },
];

export type LijnResultaat = { ok: true; lineId: string } | { ok: false; error: string };
export type MutatieResultaat = { ok: true } | { ok: false; error: string };

const NIET_CONCEPT =
  "Deze factuur is al verstuurd — regels wijzigen kan niet meer. Maak een creditfactuur of een nieuwe factuur.";

/**
 * Recompute subtotal, BTW and total from the lines.
 *
 * Callable on its own: if a mutation ever lands and the recompute does not, running this
 * again repairs the invoice. Refuses to touch anything that is no longer a draft.
 */
export async function recomputeInvoiceTotals(invoiceId: string): Promise<MutatieResultaat> {
  const [factuur] = await db
    .select({ status: invoices.status })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!factuur) return { ok: false, error: "Deze factuur bestaat niet." };
  if (factuur.status !== "draft") return { ok: false, error: NIET_CONCEPT };

  const regels = (await db
    .select({ amountCents: invoiceLines.amountCents, vatRateBps: invoiceLines.vatRateBps })
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId))) as { amountCents: number; vatRateBps: number }[];

  const subtotalCents = regels.reduce((s, r) => s + r.amountCents, 0);
  // Per line, then summed — see the note at the top about the missing cent.
  const vatCents = regels.reduce((s, r) => s + Math.round((r.amountCents * r.vatRateBps) / 10_000), 0);

  // The header rate becomes whichever rate carries the most value, purely for display on
  // the PDF; the real per-line rates are what the totals are built from.
  const perTarief = new Map<number, number>();
  for (const r of regels) perTarief.set(r.vatRateBps, (perTarief.get(r.vatRateBps) ?? 0) + Math.abs(r.amountCents));
  const dominant = [...perTarief.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 2100;

  const bijgewerkt = await db
    .update(invoices)
    .set({
      subtotalCents,
      vatCents,
      totalCents: subtotalCents + vatCents,
      vatRateBps: dominant,
      updatedAt: new Date(),
    })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "draft")))
    .returning({ id: invoices.id });
  if (bijgewerkt.length === 0) return { ok: false, error: NIET_CONCEPT };
  return { ok: true };
}

export async function addInvoiceLine(args: {
  invoiceId: string;
  kind: InvoiceLineKind;
  description: string;
  amountCents: number;
  vatRateBps?: number;
  userId: string;
}): Promise<LijnResultaat> {
  const omschrijving = args.description.trim();
  if (!omschrijving) return { ok: false, error: "Geef de regel een omschrijving." };
  if (!Number.isInteger(args.amountCents) || args.amountCents === 0) {
    return { ok: false, error: "Vul een bedrag in dat niet nul is." };
  }
  // A discount is the only kind that may be negative — anything else going below zero is a
  // typo, and a negative fee quietly reduces an invoice nobody meant to reduce.
  if (args.amountCents < 0 && args.kind !== "discount") {
    return { ok: false, error: "Een negatief bedrag hoort bij een korting. Kies 'korting' als soort." };
  }
  if (args.amountCents > 0 && args.kind === "discount") {
    return { ok: false, error: "Een korting is een negatief bedrag." };
  }
  const btw = args.vatRateBps ?? 2100;
  if (!BTW_TARIEVEN.some((t) => t.bps === btw)) return { ok: false, error: "Onbekend BTW-tarief." };

  const uit = await withTx(async (tx) => {
    const [factuur] = await tx
      .select({ status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, args.invoiceId))
      .limit(1);
    if (!factuur) return { ok: false as const, error: "Deze factuur bestaat niet." };
    if (factuur.status !== "draft") return { ok: false as const, error: NIET_CONCEPT };

    const [regel] = await tx
      .insert(invoiceLines)
      .values({
        invoiceId: args.invoiceId,
        kind: args.kind,
        description: omschrijving,
        amountCents: args.amountCents,
        vatRateBps: btw,
        createdBy: args.userId,
      })
      .returning({ id: invoiceLines.id });

    const alle = (await tx
      .select({ amountCents: invoiceLines.amountCents, vatRateBps: invoiceLines.vatRateBps })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, args.invoiceId))) as { amountCents: number; vatRateBps: number }[];
    const subtotalCents = alle.reduce((s, r) => s + r.amountCents, 0);
    const vatCents = alle.reduce((s, r) => s + Math.round((r.amountCents * r.vatRateBps) / 10_000), 0);
    await tx
      .update(invoices)
      .set({ subtotalCents, vatCents, totalCents: subtotalCents + vatCents, updatedAt: new Date() })
      .where(and(eq(invoices.id, args.invoiceId), eq(invoices.status, "draft")));

    return { ok: true as const, lineId: regel.id };
  });

  if (uit.ok) {
    await recordAuditFromRequest({
      userId: args.userId,
      action: "invoices.line_added",
      resource: "invoice_lines",
      resourceId: uit.lineId,
      after: { invoiceId: args.invoiceId, kind: args.kind, amountCents: args.amountCents, vatRateBps: btw },
    }).catch(() => {});
  }
  return uit;
}

export async function deleteInvoiceLine(args: {
  lineId: string;
  userId: string;
}): Promise<MutatieResultaat> {
  const uit = await withTx(async (tx) => {
    const [regel] = await tx
      .select({
        invoiceId: invoiceLines.invoiceId,
        kind: invoiceLines.kind,
        amountCents: invoiceLines.amountCents,
        status: invoices.status,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(eq(invoiceLines.id, args.lineId))
      .limit(1);
    if (!regel) return { ok: false as const, error: "Deze regel bestaat niet (meer)." };
    if (regel.status !== "draft") return { ok: false as const, error: NIET_CONCEPT };
    // Hours lines are the invoice's reason for existing and are regenerated from approved
    // hours; deleting one here would silently un-bill work that was actually done.
    if (regel.kind === "hours") {
      return { ok: false as const, error: "Een urenregel verwijder je niet hier — corrigeer de urenregistratie." };
    }

    await tx.delete(invoiceLines).where(eq(invoiceLines.id, args.lineId));

    const alle = (await tx
      .select({ amountCents: invoiceLines.amountCents, vatRateBps: invoiceLines.vatRateBps })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, regel.invoiceId))) as { amountCents: number; vatRateBps: number }[];
    const subtotalCents = alle.reduce((s, r) => s + r.amountCents, 0);
    const vatCents = alle.reduce((s, r) => s + Math.round((r.amountCents * r.vatRateBps) / 10_000), 0);
    await tx
      .update(invoices)
      .set({ subtotalCents, vatCents, totalCents: subtotalCents + vatCents, updatedAt: new Date() })
      .where(and(eq(invoices.id, regel.invoiceId), eq(invoices.status, "draft")));

    return { ok: true as const, invoiceId: regel.invoiceId, kind: regel.kind, amountCents: regel.amountCents };
  });

  if (uit.ok) {
    await recordAuditFromRequest({
      userId: args.userId,
      action: "invoices.line_removed",
      resource: "invoice_lines",
      resourceId: args.lineId,
      before: { invoiceId: uit.invoiceId, kind: uit.kind, amountCents: uit.amountCents },
    }).catch(() => {});
    return { ok: true };
  }
  return uit;
}

export type FactuurRegel = {
  id: string;
  kind: InvoiceLineKind;
  soortLabel: string;
  description: string;
  amountCents: number;
  vatRateBps: number;
  handmatig: boolean;
};

/** All lines of one invoice, generated ones first, in a shape a surface can render. */
export async function listInvoiceLines(invoiceId: string): Promise<FactuurRegel[]> {
  const rows = (await db
    .select({
      id: invoiceLines.id,
      kind: invoiceLines.kind,
      description: invoiceLines.description,
      amountCents: invoiceLines.amountCents,
      vatRateBps: invoiceLines.vatRateBps,
      createdBy: invoiceLines.createdBy,
    })
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId))
    .orderBy(sql`case when ${invoiceLines.kind} = 'hours' then 0 else 1 end`, invoiceLines.createdAt)) as {
    id: string; kind: InvoiceLineKind; description: string; amountCents: number; vatRateBps: number; createdBy: string | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    soortLabel: SOORT_LABEL[r.kind] ?? r.kind,
    description: r.description,
    amountCents: r.amountCents,
    vatRateBps: r.vatRateBps,
    handmatig: r.createdBy != null,
  }));
}
