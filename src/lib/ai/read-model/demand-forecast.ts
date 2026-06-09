/**
 * Demand-forecast read-model — the forward, multi-week staffing outlook: "waar kom ik chefs tekort?".
 *
 * Aggregates UPCOMING shifts (not cancelled/completed) by ISO-week + role and computes the open slots
 * (headcount − confirmed placements), surfacing shortfalls like "week 28: 4 sous-chefs tekort" so
 * Maarten can recruit/steer ahead. These are forward FACTS (real future shifts + their current fill
 * state), not an ML prediction. AVG-safe: only counts per role + week — no chef/client PII.
 */
import { and, eq, gte, inArray, lt, notInArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { placements, shifts } from "@/lib/db/schema";

const ROLE_LABEL: Record<string, string> = {
  keukenhulp: "keukenhulp",
  bediening: "bediening",
  host: "host",
  runner: "runner",
  commis: "commis",
  chef_de_partie: "chef de partie",
  sous_chef: "sous-chef",
  chef_de_cuisine: "chef de cuisine",
  executive_chef: "executive chef",
  patissier: "patissier",
};
const roleLabel = (r: string): string => ROLE_LABEL[r] ?? r.replace(/_/g, " ");

/** ISO-8601 week number + Monday (UTC date math; good enough for a planning outlook). */
function isoWeek(d: Date): { key: string; weekNo: number; monday: string } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7; // Mon=1 … Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - day); // shift to the Thursday of this ISO week
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - 3); // Thursday − 3 = Monday
  return {
    key: `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`,
    weekNo,
    monday: monday.toISOString().slice(0, 10),
  };
}

export type WeekRoleDemand = {
  isoWeek: string;
  weekNo: number;
  weekStart: string;
  role: string;
  needed: number;
  filled: number;
  open: number;
  shifts: number;
};

export type DemandForecast = {
  weeks: number;
  from: string;
  to: string;
  rows: WeekRoleDemand[]; // open > 0 only, sorted by week then biggest gap first
  shortfalls: { isoWeek: string; weekNo: number; role: string; open: number }[];
  totalOpen: number;
};

export async function buildDemandForecast(now: Date, weeks = 6): Promise<DemandForecast> {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + weeks * 7);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const upcoming = await db
    .select({
      id: shifts.id,
      startsAt: shifts.startsAt,
      role: shifts.roleNeeded,
      headcount: shifts.headcount,
    })
    .from(shifts)
    .where(
      and(
        gte(shifts.startsAt, from),
        lt(shifts.startsAt, to),
        notInArray(shifts.status, ["cancelled", "completed"]),
      ),
    );
  if (upcoming.length === 0) {
    return { weeks, from: iso(from), to: iso(to), rows: [], shortfalls: [], totalOpen: 0 };
  }

  // Confirmed placements = filled slots (matches the roster "gevuld = confirmed" rule).
  const confirmed = await db
    .select({ shiftId: placements.shiftId })
    .from(placements)
    .where(
      and(
        inArray(placements.shiftId, upcoming.map((s) => s.id)),
        eq(placements.status, "confirmed"),
      ),
    );
  const filledByShift = new Map<string, number>();
  for (const p of confirmed) filledByShift.set(p.shiftId, (filledByShift.get(p.shiftId) ?? 0) + 1);

  const agg = new Map<string, WeekRoleDemand>();
  for (const s of upcoming) {
    const wk = isoWeek(s.startsAt as Date);
    const headcount = s.headcount || 1;
    const filled = Math.min(filledByShift.get(s.id) ?? 0, headcount);
    const open = Math.max(0, headcount - filled);
    const key = `${wk.key}|${s.role}`;
    let row = agg.get(key);
    if (!row) {
      row = {
        isoWeek: wk.key,
        weekNo: wk.weekNo,
        weekStart: wk.monday,
        role: roleLabel(s.role as string),
        needed: 0,
        filled: 0,
        open: 0,
        shifts: 0,
      };
      agg.set(key, row);
    }
    row.needed += headcount;
    row.filled += filled;
    row.open += open;
    row.shifts += 1;
  }

  const rows = [...agg.values()]
    .filter((r) => r.open > 0)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || b.open - a.open);
  const shortfalls = rows.map((r) => ({ isoWeek: r.isoWeek, weekNo: r.weekNo, role: r.role, open: r.open }));
  const totalOpen = rows.reduce((sum, r) => sum + r.open, 0);
  return { weeks, from: iso(from), to: iso(to), rows, shortfalls, totalOpen };
}
