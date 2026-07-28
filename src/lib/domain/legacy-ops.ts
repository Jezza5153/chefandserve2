/**
 * Reads over the legacy operational archive (`legacy_ops_days`, `legacy_client_months`).
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
import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { legacyClientMonths, legacyOpsDays } from "@/lib/db/schema";

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
      month: sql<string>`to_char(${legacyOpsDays.day}, 'YYYY-MM')`,
      diensten: sql<number>`sum(${legacyOpsDays.orders})::int`,
      uren: sql<number>`sum(${legacyOpsDays.hoursFilled})::int`,
      slotsF: sql<number>`sum(${legacyOpsDays.slotsFilled})::int`,
      slotsT: sql<number>`sum(${legacyOpsDays.slotsTotal})::int`,
    })
    .from(legacyOpsDays)
    .groupBy(sql`to_char(${legacyOpsDays.day}, 'YYYY-MM')`)
    .orderBy(desc(sql`to_char(${legacyOpsDays.day}, 'YYYY-MM')`))
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
      month: sql<string>`to_char(${legacyOpsDays.day}, 'YYYY-MM')`,
      diensten: sql<number>`sum(${legacyOpsDays.orders})::int`,
      uren: sql<number>`sum(${legacyOpsDays.hoursFilled})::int`,
      slotsF: sql<number>`sum(${legacyOpsDays.slotsFilled})::int`,
      slotsT: sql<number>`sum(${legacyOpsDays.slotsTotal})::int`,
    })
    .from(legacyOpsDays)
    .where(sql`extract(month from ${legacyOpsDays.day}) = ${month}`)
    .groupBy(sql`to_char(${legacyOpsDays.day}, 'YYYY-MM')`)
    .orderBy(desc(sql`to_char(${legacyOpsDays.day}, 'YYYY-MM')`))) as { month: string; diensten: number; uren: number; slotsF: number; slotsT: number }[];

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
      klant: legacyClientMonths.clientName,
      clientId: sql<string | null>`max(${legacyClientMonths.clientId})`,
      diensten: sql<number>`sum(${legacyClientMonths.shifts})::int`,
      eerste: sql<string>`to_char(min(${legacyClientMonths.month}), 'YYYY-MM')`,
      laatste: sql<string>`to_char(max(${legacyClientMonths.month}), 'YYYY-MM')`,
    })
    .from(legacyClientMonths)
    .groupBy(legacyClientMonths.clientName)
    .orderBy(desc(sql`sum(${legacyClientMonths.shifts})`))
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
  dagen: number; diensten: number; uren: number; bezettingPct: number | null; van: string | null; tot: string | null;
} | null> {
  const [r] = (await db
    .select({
      dagen: sql<number>`count(*)::int`,
      diensten: sql<number>`coalesce(sum(${legacyOpsDays.orders}), 0)::int`,
      uren: sql<number>`coalesce(sum(${legacyOpsDays.hoursFilled}), 0)::int`,
      slotsF: sql<number>`coalesce(sum(${legacyOpsDays.slotsFilled}), 0)::int`,
      slotsT: sql<number>`coalesce(sum(${legacyOpsDays.slotsTotal}), 0)::int`,
      van: sql<string | null>`to_char(min(${legacyOpsDays.day}), 'YYYY-MM-DD')`,
      tot: sql<string | null>`to_char(max(${legacyOpsDays.day}), 'YYYY-MM-DD')`,
    })
    .from(legacyOpsDays)) as { dagen: number; diensten: number; uren: number; slotsF: number; slotsT: number; van: string | null; tot: string | null }[];
  if (!r || r.dagen === 0) return null;
  return {
    dagen: r.dagen,
    diensten: r.diensten,
    uren: r.uren,
    bezettingPct: r.slotsT > 0 ? Math.round((r.slotsF / r.slotsT) * 100) : null,
    van: r.van,
    tot: r.tot,
  };
}

/** Months this klant booked in the archive (for the klant page + the AI). */
export async function getLegacyMonthsForClient(clientId: string, limit = 18): Promise<{ month: string; shifts: number }[]> {
  const rows = (await db
    .select({ month: sql<string>`to_char(${legacyClientMonths.month}, 'YYYY-MM')`, shifts: legacyClientMonths.shifts })
    .from(legacyClientMonths)
    .where(and(eq(legacyClientMonths.clientId, clientId), isNotNull(legacyClientMonths.clientId)))
    .orderBy(desc(legacyClientMonths.month))
    .limit(limit)) as { month: string; shifts: number }[];
  return rows;
}

/** Archive slice for an explicit window — used by the reporting surfaces. */
export async function getLegacyRange(fromDay: string, toDay: string) {
  const [r] = (await db
    .select({
      diensten: sql<number>`coalesce(sum(${legacyOpsDays.orders}), 0)::int`,
      uren: sql<number>`coalesce(sum(${legacyOpsDays.hoursFilled}), 0)::int`,
      slotsF: sql<number>`coalesce(sum(${legacyOpsDays.slotsFilled}), 0)::int`,
      slotsT: sql<number>`coalesce(sum(${legacyOpsDays.slotsTotal}), 0)::int`,
    })
    .from(legacyOpsDays)
    .where(and(gte(legacyOpsDays.day, fromDay), lte(legacyOpsDays.day, toDay)))) as { diensten: number; uren: number; slotsF: number; slotsT: number }[];
  return {
    diensten: r?.diensten ?? 0,
    uren: r?.uren ?? 0,
    bezettingPct: r && r.slotsT > 0 ? Math.round((r.slotsF / r.slotsT) * 100) : null,
  };
}
