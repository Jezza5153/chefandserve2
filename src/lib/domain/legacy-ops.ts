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
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { legacyClientTotals, legacyOpsMonths } from "@/lib/db/schema";

export type LegacySeason = {
  /** "2025-07" */
  month: string;
  diensten: number;
  urenGewerkt: number;
  /** 0..100, or null when that month has no slots at all. */
  bezettingPct: number | null;
};

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

  return rows.map((r) => ({
    month: r.month,
    diensten: r.diensten,
    urenGewerkt: r.uren,
    bezettingPct: r.slotsT > 0 ? Math.round((r.slotsF / r.slotsT) * 100) : null,
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

  return rows.map((r) => ({
    month: r.month,
    diensten: r.diensten,
    urenGewerkt: r.uren,
    bezettingPct: r.slotsT > 0 ? Math.round((r.slotsF / r.slotsT) * 100) : null,
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

/**
 * Words that say nothing about WHICH venue this is — legal forms, the word "hotel", the
 * city everything sits in. Two names sharing only these are not the same venue.
 */
const NIETSZEGGEND = new Set([
  "bv", "b", "v", "nv", "n", "hotel", "hotels", "by", "the", "de", "het", "van", "der", "den",
  "group", "exploitatie", "main", "restaurant", "amsterdam", "aan", "zee", "com", "opco",
]);

const kenmerkend = (naam: string): Set<string> =>
  new Set(
    naam
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !NIETSZEGGEND.has(w)),
  );

/**
 * The old system re-registered debiteuren instead of renaming them, so one venue can appear
 * as "Hilton | Hotel Operational Company B.V. Schiphol" (stopped) and "Hilton / Schiphol"
 * (still booking). Without this, the first reads as a lost klant while the venue never left.
 *
 * Two entries are the same venue when they share at least two distinctive words AND one of
 * those is long enough to actually identify something ("schiphol", "parkinn" — not "aan zee").
 */
function zelfdeLocatie(a: Set<string>, b: Set<string>): boolean {
  const gedeeld = [...a].filter((w) => b.has(w));
  return gedeeld.length >= 2 && gedeeld.some((w) => w.length >= 5);
}

/** Demand per klant across the whole archive — with where each klant stands now. */
export async function getLegacyClientDemand(limit = 25): Promise<LegacyClientDemand[]> {
  const [{ recentste } = { recentste: null }] = (await db
    .select({ recentste: sql<string | null>`to_char(max(${legacyOpsMonths.month}), 'YYYY-MM')` })
    .from(legacyOpsMonths)) as { recentste: string | null }[];
  const grens = recentste ? maandMin(ankerMaand(recentste), ACTIEF_MARGE_MAANDEN) : null;

  // The whole table, not just the top `limit`: an entry can be succeeded by a smaller one
  // further down the list, and slicing first would hide that.
  const rows = (await db
    .select({
      klant: legacyClientTotals.clientName,
      clientId: legacyClientTotals.clientId,
      diensten: legacyClientTotals.shifts,
      eerste: legacyClientTotals.firstMonth,
      laatste: legacyClientTotals.lastMonth,
    })
    .from(legacyClientTotals)
    .orderBy(desc(legacyClientTotals.shifts))) as { klant: string; clientId: string | null; diensten: number; eerste: string; laatste: string }[];

  const basis = rows.map((r) => ({
    klant: r.klant,
    clientId: r.clientId,
    diensten: r.diensten,
    eersteMaand: r.eerste,
    laatsteMaand: r.laatste,
    status: (r.clientId != null
      ? "in_dit_systeem"
      : grens && r.laatste >= grens
        ? "nog_niet_overgezet"
        : "weggevallen") as LegacyClientStatus,
    woorden: kenmerkend(r.klant),
  }));

  const levend = basis.filter((r) => r.status !== "weggevallen");
  const uit: LegacyClientDemand[] = [];
  for (const r of basis.slice(0, limit)) {
    const { woorden, ...rest } = r;
    if (r.status === "weggevallen") {
      const opvolger = levend.find((l) => zelfdeLocatie(woorden, l.woorden));
      if (opvolger) {
        uit.push({ ...rest, status: "opgevolgd", voortgezetAls: opvolger.klant });
        continue;
      }
    }
    uit.push(rest);
  }
  return uit;
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
  const nu = new Date();
  const huidig = `${nu.getUTCFullYear()}-${String(nu.getUTCMonth() + 1).padStart(2, "0")}`;
  return archiefMax < huidig ? archiefMax : huidig;
}

/** "2026-08" minus n months, as "YYYY-MM". */
function maandMin(maand: string, n: number): string {
  const jaar = Number(maand.slice(0, 4));
  const m = Number(maand.slice(5, 7)) - n;
  const d = new Date(Date.UTC(jaar, m - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** One-line archive summary for a surface that wants context, not a table. */
export async function getLegacySummary(): Promise<{
  maanden: number; diensten: number; uren: number; bezettingPct: number | null; van: string | null; tot: string | null;
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
    })
    .from(legacyOpsMonths)) as { maanden: number; diensten: number; uren: number; slotsF: number; slotsT: number; van: string | null; tot: string | null }[];
  if (!r || r.maanden === 0) return null;
  return {
    maanden: r.maanden,
    diensten: r.diensten,
    uren: r.uren,
    bezettingPct: r.slotsT > 0 ? Math.round((r.slotsF / r.slotsT) * 100) : null,
    van: r.van,
    tot: r.tot,
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
