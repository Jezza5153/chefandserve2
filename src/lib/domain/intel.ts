/**
 * Chef & klant pattern intel — PR-INTEL.
 *
 * The existing read-models (chef-history, client-history, *-trends) answer
 * "how much / how good / trending?". This adds the RELATIONSHIP + PATTERN layer
 * Maarten asked for — "when do they work, what do they do, who with, what do
 * they earn here?" — so he can actually get to know his chefs + klanten.
 *
 * Pure composition over `placements`/`shifts`/`shift_hours` — no new tables.
 * Returns plain data (AI-ready: a tool can read these directly). Day-of-week is
 * computed in Europe/Amsterdam so "werkt meestal op zaterdag" is true locally.
 */
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clientMetricsDaily, clients, placements, shiftHours, shifts } from "@/lib/db/schema";

/** FINAL hours = money is real (admin-approved or already exported). */
const FINAL_HOURS = ["admin_approved", "exported"] as const;
/** A placement that actually happened / is committed. */
const REAL_PLACEMENTS = ["confirmed", "completed"] as const;

const DAY_LABELS = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];

export type DayStat = { weekday: number; label: string; count: number };
export type RoleStat = { role: string; count: number };

/** Postgres dow (0=Sun..6=Sat) rows → a Mon-first 7-slot histogram (0-filled). */
function toMonFirstHistogram(rows: Array<{ dow: number; count: number }>): DayStat[] {
  const counts = new Array(7).fill(0);
  for (const r of rows) {
    const idx = (Number(r.dow) + 6) % 7; // Sun(0)→6, Mon(1)→0, … Sat(6)→5
    counts[idx] += Number(r.count);
  }
  return counts.map((count, i) => ({ weekday: i, label: DAY_LABELS[i], count }));
}

export type ChefPatterns = {
  /** When this chef actually works (confirmed/completed), per weekday. */
  preferredDays: DayStat[];
  busiestDayLabel: string | null;
  /** Which roles they're booked for, most-first. */
  roleMix: RoleStat[];
  /** Lifetime + last-30-day payout (FINAL hours). */
  totalEarnedCents: number;
  earned30dCents: number;
  /** Earnings per klant (top relationships by money), most-first. */
  clientEarnings: Array<{ name: string; cents: number; shifts: number }>;
};

export async function getChefPatterns(chefId: string): Promise<ChefPatterns> {
  const dayRows = await db
    .select({
      dow: sql<number>`extract(dow from (${shifts.startsAt} at time zone 'Europe/Amsterdam'))::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .where(and(eq(placements.chefId, chefId), inArray(placements.status, [...REAL_PLACEMENTS])))
    .groupBy(sql`1`);
  const preferredDays = toMonFirstHistogram(dayRows);
  const busiest = [...preferredDays].sort((a, b) => b.count - a.count)[0];
  const busiestDayLabel = busiest && busiest.count > 0 ? busiest.label : null;

  const roleRows = await db
    .select({ role: shifts.roleNeeded, count: sql<number>`count(*)::int` })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .where(and(eq(placements.chefId, chefId), inArray(placements.status, [...REAL_PLACEMENTS])))
    .groupBy(shifts.roleNeeded)
    .orderBy(desc(sql`count(*)`))
    .limit(6);
  const roleMix = roleRows.map((r) => ({ role: r.role, count: Number(r.count) }));

  const earnExpr = sql`round(${shiftHours.workedMinutes} / 60.0 * ${shiftHours.chefRateCents})`;
  const earnRows = await db
    .select({
      name: clients.companyName,
      cents: sql<number>`coalesce(sum(${earnExpr}),0)::bigint`,
      shifts: sql<number>`count(*)::int`,
    })
    .from(shiftHours)
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .where(and(eq(shiftHours.chefId, chefId), inArray(shiftHours.status, [...FINAL_HOURS])))
    .groupBy(clients.companyName)
    .orderBy(desc(sql`coalesce(sum(${earnExpr}),0)`))
    .limit(8);
  const clientEarnings = earnRows.map((r) => ({
    name: r.name,
    cents: Number(r.cents),
    shifts: Number(r.shifts),
  }));

  const [totals] = await db
    .select({
      total: sql<number>`coalesce(sum(${earnExpr}),0)::bigint`,
      last30: sql<number>`coalesce(sum(case when ${shiftHours.adminApprovedAt} > now() - interval '30 days' then ${earnExpr} else 0 end),0)::bigint`,
    })
    .from(shiftHours)
    .where(and(eq(shiftHours.chefId, chefId), inArray(shiftHours.status, [...FINAL_HOURS])));

  return {
    preferredDays,
    busiestDayLabel,
    roleMix,
    totalEarnedCents: Number(totals?.total ?? 0),
    earned30dCents: Number(totals?.last30 ?? 0),
    clientEarnings,
  };
}

export type ClientPatterns = {
  /** When this klant books work (shift start), per weekday. */
  bookingDays: DayStat[];
  busiestDayLabel: string | null;
  /** Which roles they book, most-first. */
  roleMix: RoleStat[];
  /** Every chef who worked here ≥ 2×, most-first (the full repeat picture). */
  repeatChefs: Array<{ name: string; count: number }>;
};

export async function getClientPatterns(clientId: string): Promise<ClientPatterns> {
  const dayRows = await db
    .select({
      dow: sql<number>`extract(dow from (${shifts.startsAt} at time zone 'Europe/Amsterdam'))::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(shifts)
    .where(and(eq(shifts.clientId, clientId), ne(shifts.status, "cancelled")))
    .groupBy(sql`1`);
  const bookingDays = toMonFirstHistogram(dayRows);
  const busiest = [...bookingDays].sort((a, b) => b.count - a.count)[0];
  const busiestDayLabel = busiest && busiest.count > 0 ? busiest.label : null;

  const roleRows = await db
    .select({ role: shifts.roleNeeded, count: sql<number>`count(*)::int` })
    .from(shifts)
    .where(and(eq(shifts.clientId, clientId), ne(shifts.status, "cancelled")))
    .groupBy(shifts.roleNeeded)
    .orderBy(desc(sql`count(*)`))
    .limit(6);
  const roleMix = roleRows.map((r) => ({ role: r.role, count: Number(r.count) }));

  // Full repeat-chef list (≥2 confirmed/completed shifts here), most-first.
  const chefRows = await db
    .select({ name: chefs.fullName, count: sql<number>`count(*)::int` })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .where(and(eq(shifts.clientId, clientId), inArray(placements.status, [...REAL_PLACEMENTS])))
    .groupBy(chefs.id)
    .having(sql`count(*) >= 2`)
    .orderBy(desc(sql`count(*)`));
  const repeatChefs = chefRows.map((r) => ({ name: r.name, count: Number(r.count) }));

  return { bookingDays, busiestDayLabel, roleMix, repeatChefs };
}

export type PlatformIntelKpis = {
  /** Avg klant hours-signing latency (submit → sign), hours, last 90d. */
  avgSigningHours: number | null;
  /** Distinct chefs who completed a shift in the last 30 days. */
  activeChefs30d: number;
  /** Distinct klanten with a (non-cancelled) shift in the last 30 days. */
  activeKlanten30d: number;
};

/** Operator-level "are relationships healthy + responsive?" KPIs. */
export async function getPlatformIntelKpis(): Promise<PlatformIntelKpis> {
  const [sign] = await db
    .select({
      minutes: sql<number>`coalesce(sum(${clientMetricsDaily.approvalSlaMinutesSum}),0)::bigint`,
      count: sql<number>`coalesce(sum(${clientMetricsDaily.approvalSlaCount}),0)::bigint`,
    })
    .from(clientMetricsDaily)
    .where(sql`${clientMetricsDaily.snapshotDate} > current_date - 90`);
  const signCount = Number(sign?.count ?? 0);
  const avgSigningHours =
    signCount > 0 ? Math.round((Number(sign?.minutes ?? 0) / signCount / 60) * 10) / 10 : null;

  const [chefsActive] = await db
    .select({ n: sql<number>`count(distinct ${placements.chefId})::int` })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .where(and(eq(placements.status, "completed"), sql`${shifts.startsAt} > now() - interval '30 days'`));

  const [klantenActive] = await db
    .select({ n: sql<number>`count(distinct ${shifts.clientId})::int` })
    .from(shifts)
    .where(and(ne(shifts.status, "cancelled"), sql`${shifts.startsAt} > now() - interval '30 days'`));

  return {
    avgSigningHours,
    activeChefs30d: Number(chefsActive?.n ?? 0),
    activeKlanten30d: Number(klantenActive?.n ?? 0),
  };
}
