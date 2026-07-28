/**
 * Receivables: how much is outstanding, and — the part that was missing — how OLD it is.
 *
 * `invoices.dueDate` was written on every invoice and then never compared to today. Four
 * surfaces printed it as a date and none of them marked anything overdue, so the owner
 * could see "er staat € X uit" but never "de € 4.200 van hotel Y ligt er 76 dagen".
 * Chasing the oldest invoice first is the whole job of a debiteurenlijst; a list sorted by
 * issue date is not that.
 *
 * A second, quieter bug this replaces: the invoices page computed its outstanding total by
 * summing the 100 rows it had just fetched for display, filtered by whatever status the
 * user had selected. Filter to "paid" and outstanding read € 0 while the money was still
 * out there. Totals belong in a query over every invoice, never over a page of them.
 *
 * Everything here counts only `sent` invoices. Drafts are not owed yet, and paid, void and
 * credit are settled — mixing any of them in inflates the figure the owner acts on.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, invoices } from "@/lib/db/schema";

/** The standard ageing ladder; `niet_vervallen` is money owed but not yet late. */
export type OuderdomsBak = "niet_vervallen" | "1-30" | "31-60" | "61-90" | "90+";

export const OUDERDOM_LABEL: Record<OuderdomsBak, string> = {
  niet_vervallen: "nog niet vervallen",
  "1-30": "1–30 dagen te laat",
  "31-60": "31–60 dagen te laat",
  "61-90": "61–90 dagen te laat",
  "90+": "meer dan 90 dagen te laat",
};

export type OpenstaandeFactuur = {
  id: string;
  nummer: string;
  klant: string;
  clientId: string;
  bedragCents: number;
  vervaldatum: string;
  /** Whole days past the due date; 0 or negative means not late yet. */
  dagenTeLaat: number;
  bak: OuderdomsBak;
};

export type DebiteurenOuderdom = {
  /** Every sent invoice, not a page of them. */
  openCents: number;
  openAantal: number;
  teLaatCents: number;
  teLaatAantal: number;
  bakken: { bak: OuderdomsBak; label: string; cents: number; aantal: number }[];
  /** The worst offenders, oldest first — the call list. */
  oudste: OpenstaandeFactuur[];
};

/**
 * Days between the due date and now, counted in whole days.
 *
 * Both sides are floored to a date first. Without that, an invoice due today at 00:00 is
 * "0.9 days late" by lunchtime and rounds into the 1–30 bucket, so a klant gets chased on
 * the very day they were given to pay.
 */
export function dagenTeLaat(vervaldatum: Date | string, nu: Date): number {
  const d = new Date(vervaldatum);
  const due = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const today = Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate());
  return Math.floor((today - due) / 86_400_000);
}

export function bakVoor(dagen: number): OuderdomsBak {
  if (dagen <= 0) return "niet_vervallen";
  if (dagen <= 30) return "1-30";
  if (dagen <= 60) return "31-60";
  if (dagen <= 90) return "61-90";
  return "90+";
}

const LEGE_BAKKEN: OuderdomsBak[] = ["niet_vervallen", "1-30", "31-60", "61-90", "90+"];

/** The full receivables picture. `nu` is injectable so the smoke can pin a date. */
export async function getDebiteurenOuderdom(nu: Date = new Date(), topN = 10): Promise<DebiteurenOuderdom> {
  const rows = (await db
    .select({
      id: invoices.id,
      nummer: invoices.number,
      clientId: invoices.clientId,
      klant: clients.companyName,
      bedragCents: invoices.totalCents,
      vervaldatum: invoices.dueDate,
    })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(and(eq(invoices.status, "sent")))) as {
    id: string; nummer: string; clientId: string; klant: string; bedragCents: number; vervaldatum: Date;
  }[];

  const verrijkt: OpenstaandeFactuur[] = rows.map((r) => {
    const dagen = dagenTeLaat(r.vervaldatum, nu);
    return {
      id: r.id,
      nummer: r.nummer,
      klant: r.klant,
      clientId: r.clientId,
      bedragCents: r.bedragCents,
      vervaldatum: new Date(r.vervaldatum).toISOString().slice(0, 10),
      dagenTeLaat: dagen,
      bak: bakVoor(dagen),
    };
  });

  const bakken = LEGE_BAKKEN.map((bak) => {
    const inBak = verrijkt.filter((f) => f.bak === bak);
    return {
      bak,
      label: OUDERDOM_LABEL[bak],
      cents: inBak.reduce((s, f) => s + f.bedragCents, 0),
      aantal: inBak.length,
    };
  });

  const teLaat = verrijkt.filter((f) => f.dagenTeLaat > 0);
  return {
    openCents: verrijkt.reduce((s, f) => s + f.bedragCents, 0),
    openAantal: verrijkt.length,
    teLaatCents: teLaat.reduce((s, f) => s + f.bedragCents, 0),
    teLaatAantal: teLaat.length,
    bakken,
    oudste: [...teLaat].sort((a, b) => b.dagenTeLaat - a.dagenTeLaat).slice(0, topN),
  };
}

/** One line for a card or a chat answer. */
export function ouderdomSamenvatting(o: DebiteurenOuderdom): string {
  if (o.openAantal === 0) return "Er staat op dit moment niets open.";
  const euro = (c: number) => `€ ${(c / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (o.teLaatAantal === 0) {
    return `${euro(o.openCents)} open over ${o.openAantal} ${o.openAantal === 1 ? "factuur" : "facturen"} — nog niets vervallen.`;
  }
  const ergste = o.oudste[0];
  return (
    `${euro(o.openCents)} open, waarvan ${euro(o.teLaatCents)} te laat ` +
    `(${o.teLaatAantal} ${o.teLaatAantal === 1 ? "factuur" : "facturen"}). ` +
    `Oudste: ${ergste.klant}, ${ergste.dagenTeLaat} dagen over de vervaldatum (${ergste.nummer}).`
  );
}

/** Total outstanding across every sent invoice — the number the list page needs. */
export async function getOpenstaandTotaalCents(): Promise<number> {
  const [r] = (await db
    .select({ cents: sql<number>`coalesce(sum(${invoices.totalCents}), 0)::int` })
    .from(invoices)
    .where(eq(invoices.status, "sent"))) as { cents: number }[];
  return r?.cents ?? 0;
}
