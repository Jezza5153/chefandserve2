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

export type LegacyClientDemand = {
  klant: string;
  clientId: string | null;
  diensten: number;
  eersteMaand: string;
  laatsteMaand: string;
  /** True when this klant no longer exists as an active klant in this system. */
  nietMeerActief: boolean;
};

/** Demand per klant across the whole archive — including klanten we lost. */
export async function getLegacyClientDemand(limit = 25): Promise<LegacyClientDemand[]> {
  const rows = (await db
    .select({
      klant: legacyClientTotals.clientName,
      clientId: legacyClientTotals.clientId,
      diensten: legacyClientTotals.shifts,
      eerste: legacyClientTotals.firstMonth,
      laatste: legacyClientTotals.lastMonth,
    })
    .from(legacyClientTotals)
    .orderBy(desc(legacyClientTotals.shifts))
    .limit(limit)) as { klant: string; clientId: string | null; diensten: number; eerste: string; laatste: string }[];

  return rows.map((r) => ({
    klant: r.klant,
    clientId: r.clientId,
    diensten: r.diensten,
    eersteMaand: r.eerste,
    laatsteMaand: r.laatste,
    nietMeerActief: r.clientId == null,
  }));
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

/** This klant's archive line (for the klant page + the AI), or null when unknown there. */
export async function getLegacyForClient(clientId: string): Promise<{ diensten: number; eersteMaand: string; laatsteMaand: string } | null> {
  const [r] = (await db
    .select({ diensten: legacyClientTotals.shifts, eerste: legacyClientTotals.firstMonth, laatste: legacyClientTotals.lastMonth })
    .from(legacyClientTotals)
    .where(eq(legacyClientTotals.clientId, clientId))
    .orderBy(desc(legacyClientTotals.shifts))
    .limit(1)) as { diensten: number; eerste: string; laatste: string }[];
  return r ? { diensten: r.diensten, eersteMaand: r.eerste, laatsteMaand: r.laatste } : null;
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
