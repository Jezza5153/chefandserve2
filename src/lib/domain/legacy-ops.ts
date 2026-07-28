/**
 * Reads over the legacy operational archive (`legacy_ops_months`, `legacy_client_totals`).
 *
 * The new system's own KPI numbers are honest but empty: no shifts have run in it yet, so
 * fill rate, seasonality and demand all read 0. The agency itself has been running 30–40
 * diensten a day since 2022. These reads let a surface say "vorig jaar deze maand deden we
 * X" instead of showing a zero that looks like a dead business.
 *
 * Everything here is explicitly LABELLED legacy. It must never be summed together with our
 * own placements — different systems, different definitions of "filled". Surfaces show them
 * side by side ("nieuw systeem / oude systeem"), never added up.
 */
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, legacyClientTotals, legacyOpsMonths } from "@/lib/db/schema";
import { besteMatch, isOpvolgerVan } from "@/lib/domain/legacy-match";

export type LegacySeason = {
  /** "2025-07" */
  month: string;
  diensten: number;
  urenGewerkt: number;
  /** 0..100, or null when that month has no slots at all. */
  bezettingPct: number | null;
  /**
   * False for the month we are in and any month after it. The agenda holds shifts that are
   * booked but have not happened, so the newest rows are partial by nature — August showing
   * 24 diensten against July's 381 is three days of forward bookings, not a collapse, and
   * anything that averages or compares months has to leave these out.
   */
  afgerond: boolean;
};

/** The month we are in, in the timezone the agency actually works in. */
function huidigeMaand(): string {
  const delen = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const bij = (type: string) => delen.find((d) => d.type === type)?.value ?? "";
  return `${bij("year")}-${bij("month")}`;
}

/** Month-by-month totals from the archive, newest first. */
export async function getLegacyMonths(limit = 24): Promise<LegacySeason[]> {
  const rows = (await db
    .select({
      month: sql<string>`to_char(${legacyOpsMonths.month}, 'YYYY-MM')`,
      diensten: sql<number>`sum(${legacyOpsMonths.orders})::int`,
      uren: sql<number>`sum(${legacyOpsMonths.hoursFilled})::int`,
      slotsF: sql<number>`sum(${legacyOpsMonths.slotsFilled})::int`,
      slotsT: sql<number>`sum(${legacyOpsMonths.slotsTotal})::int`,
    })
    .from(legacyOpsMonths)
    .groupBy(sql`to_char(${legacyOpsMonths.month}, 'YYYY-MM')`)
    .orderBy(desc(sql`to_char(${legacyOpsMonths.month}, 'YYYY-MM')`))
    .limit(limit)) as { month: string; diensten: number; uren: number; slotsF: number; slotsT: number }[];

  const nu = huidigeMaand();
  return rows.map((r) => ({
    month: r.month,
    diensten: r.diensten,
    urenGewerkt: r.uren,
    bezettingPct: r.slotsT > 0 ? Math.round((r.slotsF / r.slotsT) * 100) : null,
    afgerond: r.month < nu,
  }));
}

/**
 * What the SAME month looked like in earlier years — the honest way to answer "is dit
 * normaal voor juli?" while our own system has no history to compare against.
 */
export async function getLegacySameMonth(month: number): Promise<LegacySeason[]> {
  const rows = (await db
    .select({
      month: sql<string>`to_char(${legacyOpsMonths.month}, 'YYYY-MM')`,
      diensten: sql<number>`sum(${legacyOpsMonths.orders})::int`,
      uren: sql<number>`sum(${legacyOpsMonths.hoursFilled})::int`,
      slotsF: sql<number>`sum(${legacyOpsMonths.slotsFilled})::int`,
      slotsT: sql<number>`sum(${legacyOpsMonths.slotsTotal})::int`,
    })
    .from(legacyOpsMonths)
    .where(sql`extract(month from ${legacyOpsMonths.month}) = ${month}`)
    .groupBy(sql`to_char(${legacyOpsMonths.month}, 'YYYY-MM')`)
    .orderBy(desc(sql`to_char(${legacyOpsMonths.month}, 'YYYY-MM')`))) as { month: string; diensten: number; uren: number; slotsF: number; slotsT: number }[];

  const nu = huidigeMaand();
  return rows.map((r) => ({
    month: r.month,
    diensten: r.diensten,
    urenGewerkt: r.uren,
    bezettingPct: r.slotsT > 0 ? Math.round((r.slotsF / r.slotsT) * 100) : null,
    afgerond: r.month < nu,
  }));
}

/**
 * Where a klant from the archive stands TODAY.
 *
 * The old system was not switched off — it is still taking bookings. So "not in this
 * system" does not mean "lost": it can just as well mean "still booking over there and
 * never migrated", which is an account to move, not an account to mourn. Distinguishing
 * the two is the whole point of this field; collapsing them once produced the false
 * headline "we lost Holland Casino, Hilton, Amstel, Sheraton and Okura".
 */
export type LegacyClientStatus =
  /** Exists here as an active klant. */
  | "in_dit_systeem"
  /** Still booking in the old system recently, but has no klant record here yet. */
  | "nog_niet_overgezet"
  /** The name stopped, but the same venue continues under a newer entry. */
  | "opgevolgd"
  /** Stopped booking a while ago and is not here either — genuinely gone. */
  | "weggevallen";

export type LegacyClientDemand = {
  klant: string;
  clientId: string | null;
  diensten: number;
  eersteMaand: string;
  laatsteMaand: string;
  status: LegacyClientStatus;
  /** For status "opgevolgd": the entry that carries this venue now. */
  voortgezetAls?: string;
};

/** How recent a klant's last month must be to still count as booking. */
const ACTIEF_MARGE_MAANDEN = 3;

export type LegacyClientOverzicht = {
  /** The biggest `limit` klanten, for display. */
  klanten: LegacyClientDemand[];
  /** Counts over the WHOLE archive, never over the slice above. */
  totalen: Record<LegacyClientStatus, number>;
  /** Every klant still booking there without a record here — the actionable list. */
  teMigreren: LegacyClientDemand[];
};

/**
 * Demand per klant across the whole archive — with where each klant stands now.
 *
 * The counts and the migrate-list are computed over every row and returned separately from
 * the display slice on purpose. When they were derived from the top-N, the four klanten
 * worth acting on ranked 19th and lower, so the default call reported none of them and
 * ended on the loss count — the correction was invisible at exactly the size the assistant
 * actually asks for.
 */
export async function getLegacyClientDemand(limit = 25): Promise<LegacyClientOverzicht> {
  const [{ recentste } = { recentste: null }] = (await db
    .select({ recentste: sql<string | null>`to_char(max(${legacyOpsMonths.month}), 'YYYY-MM')` })
    .from(legacyOpsMonths)) as { recentste: string | null }[];
  const grens = recentste ? maandMin(ankerMaand(recentste), ACTIEF_MARGE_MAANDEN) : null;

  const [rows, huidigeKlanten] = await Promise.all([
    db
      .select({
        klant: legacyClientTotals.clientName,
        clientId: legacyClientTotals.clientId,
        diensten: legacyClientTotals.shifts,
        eerste: legacyClientTotals.firstMonth,
        laatste: legacyClientTotals.lastMonth,
      })
      .from(legacyClientTotals)
      .orderBy(desc(legacyClientTotals.shifts)) as Promise<
      { klant: string; clientId: string | null; diensten: number; eerste: string; laatste: string }[]
    >,
    db
      .select({ id: clients.id, naam: clients.companyName })
      .from(clients)
      .where(isNull(clients.deletedAt)) as Promise<{ id: string; naam: string }[]>,
  ]);

  // Re-match here as well as in the importer. The stored clientId is only as good as the
  // last import run, and telling the owner "go migrate this account" about a klant they
  // already have is the same class of error as calling them lost.
  const kandidaten = huidigeKlanten.map((c) => ({ waarde: c.id, naam: c.naam }));
  const basis = rows.map((r) => {
    const clientId = r.clientId ?? besteMatch(r.klant, kandidaten);
    return {
      klant: r.klant,
      clientId,
      diensten: r.diensten,
      eersteMaand: r.eerste,
      laatsteMaand: r.laatste,
      status: (clientId != null
        ? "in_dit_systeem"
        : grens && r.laatste >= grens
          ? "nog_niet_overgezet"
          : "weggevallen") as LegacyClientStatus,
    };
  });

  // An entry only counts as succeeded by one that is itself still alive.
  const levend = basis.filter((r) => r.status !== "weggevallen");
  const beoordeeld: LegacyClientDemand[] = basis.map((r) => {
    if (r.status !== "weggevallen") return r;
    const opvolger = levend.find((l) =>
      isOpvolgerVan(
        { naam: r.klant, eerste: r.eersteMaand, laatste: r.laatsteMaand },
        { naam: l.klant, eerste: l.eersteMaand, laatste: l.laatsteMaand },
      ),
    );
    return opvolger ? { ...r, status: "opgevolgd", voortgezetAls: opvolger.klant } : r;
  });

  const totalen: Record<LegacyClientStatus, number> = {
    in_dit_systeem: 0,
    nog_niet_overgezet: 0,
    opgevolgd: 0,
    weggevallen: 0,
  };
  for (const r of beoordeeld) totalen[r.status]++;

  return {
    klanten: beoordeeld.slice(0, limit),
    totalen,
    teMigreren: beoordeeld.filter((r) => r.status === "nog_niet_overgezet").sort((a, b) => b.diensten - a.diensten),
  };
}

/**
 * Which month "recently" is measured back from.
 *
 * Two ways this goes wrong if you just take the archive's newest month. The agenda holds
 * FUTURE bookings, so that month can sit ahead of today — book six months out and the window
 * slides past klanten who are booking right now. And if the archive is never refreshed
 * again, anchoring on today instead would quietly drift every klant into "weggevallen" and
 * lose the "go migrate this account" signal.
 *
 * So: the newest month we have, but never later than the month we are actually in.
 */
function ankerMaand(archiefMax: string): string {
  const huidig = huidigeMaand();
  return archiefMax < huidig ? archiefMax : huidig;
}

/** "2026-08" minus n months, as "YYYY-MM". */
function maandMin(maand: string, n: number): string {
  const jaar = Number(maand.slice(0, 4));
  const m = Number(maand.slice(5, 7)) - n;
  const d = new Date(Date.UTC(jaar, m - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * One-line archive summary for a surface that wants context, not a table.
 *
 * `bijgewerkt` is here because everything else in this file speaks in the present tense
 * ("boekt nog", "nog niet overgezet") off a snapshot that is only as fresh as the last
 * import run. Without a date next to it, a year-old snapshot still sounds like today.
 */
export async function getLegacySummary(): Promise<{
  maanden: number; diensten: number; uren: number; bezettingPct: number | null; van: string | null; tot: string | null; bijgewerkt: string | null;
} | null> {
  const [r] = (await db
    .select({
      maanden: sql<number>`count(*)::int`,
      diensten: sql<number>`coalesce(sum(${legacyOpsMonths.orders}), 0)::int`,
      uren: sql<number>`coalesce(sum(${legacyOpsMonths.hoursFilled}), 0)::int`,
      slotsF: sql<number>`coalesce(sum(${legacyOpsMonths.slotsFilled}), 0)::int`,
      slotsT: sql<number>`coalesce(sum(${legacyOpsMonths.slotsTotal}), 0)::int`,
      van: sql<string | null>`to_char(min(${legacyOpsMonths.month}), 'YYYY-MM-DD')`,
      tot: sql<string | null>`to_char(max(${legacyOpsMonths.month}), 'YYYY-MM-DD')`,
      bijgewerkt: sql<string | null>`to_char(max(${legacyOpsMonths.createdAt}), 'YYYY-MM-DD')`,
    })
    .from(legacyOpsMonths)) as { maanden: number; diensten: number; uren: number; slotsF: number; slotsT: number; van: string | null; tot: string | null; bijgewerkt: string | null }[];
  if (!r || r.maanden === 0) return null;
  return {
    maanden: r.maanden,
    diensten: r.diensten,
    uren: r.uren,
    bezettingPct: r.slotsT > 0 ? Math.round((r.slotsF / r.slotsT) * 100) : null,
    van: r.van,
    tot: r.tot,
    bijgewerkt: r.bijgewerkt,
  };
}

/**
 * This klant's archive line (for the klant page + the AI), or null when unknown there.
 *
 * Summed across rows on purpose: the old system re-registered a venue under a new debiteur
 * instead of renaming it, so one klant here can carry several archive rows. Taking only the
 * biggest would quietly drop the years booked under the earlier name.
 */
export async function getLegacyForClient(clientId: string): Promise<{ diensten: number; eersteMaand: string; laatsteMaand: string } | null> {
  const [r] = (await db
    .select({
      diensten: sql<number>`sum(${legacyClientTotals.shifts})::int`,
      eerste: sql<string | null>`min(${legacyClientTotals.firstMonth})`,
      laatste: sql<string | null>`max(${legacyClientTotals.lastMonth})`,
    })
    .from(legacyClientTotals)
    .where(eq(legacyClientTotals.clientId, clientId))) as { diensten: number | null; eerste: string | null; laatste: string | null }[];
  return r?.diensten && r.eerste && r.laatste
    ? { diensten: r.diensten, eersteMaand: r.eerste, laatsteMaand: r.laatste }
    : null;
}

/** Archive slice for an explicit window — used by the reporting surfaces. */
export async function getLegacyRange(fromDay: string, toDay: string) {
  const [r] = (await db
    .select({
      diensten: sql<number>`coalesce(sum(${legacyOpsMonths.orders}), 0)::int`,
      uren: sql<number>`coalesce(sum(${legacyOpsMonths.hoursFilled}), 0)::int`,
      slotsF: sql<number>`coalesce(sum(${legacyOpsMonths.slotsFilled}), 0)::int`,
      slotsT: sql<number>`coalesce(sum(${legacyOpsMonths.slotsTotal}), 0)::int`,
    })
    .from(legacyOpsMonths)
    .where(and(gte(legacyOpsMonths.month, fromDay), lte(legacyOpsMonths.month, toDay)))) as { diensten: number; uren: number; slotsF: number; slotsT: number }[];
  return {
    diensten: r?.diensten ?? 0,
    uren: r?.uren ?? 0,
    bezettingPct: r && r.slotsT > 0 ? Math.round((r.slotsF / r.slotsT) * 100) : null,
  };
}
