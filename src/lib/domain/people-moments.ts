/**
 * People moments — birthdays, work anniversaries and shift milestones, in ONE place.
 *
 * Born from a real failure: the owner asked the assistant "is er iemand jarig
 * binnenkort" and it truthfully answered that no tool exposes birthdays — they lived
 * on the dashboard card, the ChefCard and the briefing, but not in anything the model
 * could call. Every surface (dashboard rail, chefs.momenten tool, briefing) now reads
 * THIS function, so they can never disagree and the assistant is never blind again.
 *
 * INTERNAL-ONLY: birthday data is for the owner's relationship practice, never for
 * chef/klant surfaces.
 */
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefMetricsDaily, chefs } from "@/lib/db/schema";

export type PeopleMoment = {
  chefId: string;
  name: string;
  kind: "birthday" | "anniversary" | "milestone";
  /** Days from today (0 = vandaag). */
  inDays: number;
  /** Human line, Dutch: "Jarig over 4 dagen", "3 jaar bij ons", "Bijna 100e dienst (97)". */
  label: string;
};

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Days from `from` (UTC calendar) to the next month/day occurrence.
 *  Feb-29 celebrates Feb-28 in common years (same rule as workers/reminders.ts). */
function daysUntilNext(month: number, day: number, from: Date): number {
  const ty = from.getUTCFullYear();
  const base = Date.UTC(ty, from.getUTCMonth(), from.getUTCDate());
  for (let y = ty; y <= ty + 1; y++) {
    const d = month === 2 && day === 29 && !isLeapYear(y) ? 28 : day;
    const diff = Math.round((Date.UTC(y, month - 1, d) - base) / 864e5);
    if (diff >= 0) return diff;
  }
  return 999;
}

const dayWord = (n: number) => (n === 0 ? "vandaag" : n === 1 ? "morgen" : `over ${n} dagen`);

export type PeopleMomentsResult = { moments: PeopleMoment[]; chefsWithDob: number; activeChefs: number };

export async function getPeopleMomentsDetailed(opts: { windowDays?: number } = {}): Promise<PeopleMomentsResult> {
  const moments = await getPeopleMoments(opts);
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      withDob: sql<number>`count(${chefs.dateOfBirth})::int`,
    })
    .from(chefs)
    .where(and(isNull(chefs.deletedAt), eq(chefs.status, "active")));
  return { moments, chefsWithDob: row?.withDob ?? 0, activeChefs: row?.total ?? 0 };
}

export async function getPeopleMoments(opts: { windowDays?: number } = {}): Promise<PeopleMoment[]> {
  const windowDays = Math.min(Math.max(opts.windowDays ?? 14, 1), 62);
  const now = new Date();

  const [rows, lifeRows] = await Promise.all([
    db
      .select({
        id: chefs.id,
        fullName: chefs.fullName,
        dateOfBirth: chefs.dateOfBirth,
        joinedAt: chefs.joinedAt,
        // Migration guard: chefs imported from the old system got joinedAt = IMPORT date.
        // 167 of them have since been given their real (oldest-note) start date, so the
        // test is the DATE itself, not a notes marker: anything still inside the migration
        // window is a placeholder and must not fire a jubileum. Self-correcting — the day
        // a chef gets a real date, their anniversary starts working.
        joinedAtIsPlaceholder: sql<boolean>`${chefs.joinedAt} >= timestamptz '2026-07-26'`,
      })
      .from(chefs)
      .where(and(isNull(chefs.deletedAt), eq(chefs.status, "active"))),
    db
      .select({
        chefId: chefMetricsDaily.chefId,
        totalShifts: sql<number>`coalesce(sum(${chefMetricsDaily.completedShifts}), 0)::int`,
      })
      .from(chefMetricsDaily)
      .groupBy(chefMetricsDaily.chefId),
  ]);
  const life = new Map(lifeRows.map((r) => [r.chefId, r.totalShifts]));

  const out: PeopleMoment[] = [];
  for (const c of rows) {
    if (c.dateOfBirth) {
      const [, bm, bd] = c.dateOfBirth.split("-").map(Number);
      const n = daysUntilNext(bm!, bd!, now);
      if (n <= windowDays) {
        out.push({
          chefId: c.id,
          name: c.fullName,
          kind: "birthday",
          inDays: n,
          label: n === 0 ? "Is VANDAAG jarig 🎉" : `Jarig ${dayWord(n)}`,
        });
      }
    }
    const j = new Date(c.joinedAt);
    const jn = daysUntilNext(j.getUTCMonth() + 1, j.getUTCDate(), now);
    const anniversaryYear = now.getUTCFullYear() + (jn > 300 ? 0 : jn === 0 ? 0 : 1) - j.getUTCFullYear();
    // Anniversary bomb guard: a chef whose joinedAt is still the import placeholder would
    // otherwise fire a fake "1 jaar bij ons" — together with every other migrated chef, on
    // the same day. Birthdays and milestones are unaffected.
    if (jn <= windowDays && anniversaryYear >= 1 && !c.joinedAtIsPlaceholder) {
      out.push({
        chefId: c.id,
        name: c.fullName,
        kind: "anniversary",
        inDays: jn,
        label: `${anniversaryYear} jaar bij ons ${dayWord(jn)}`,
      });
    }
    const shiftsDone = life.get(c.id) ?? 0;
    for (const m of [10, 25, 50, 100, 250, 500]) {
      if (shiftsDone >= m - 3 && shiftsDone < m) {
        out.push({
          chefId: c.id,
          name: c.fullName,
          kind: "milestone",
          inDays: 0,
          label: `Bijna ${m}e dienst (${shiftsDone})`,
        });
        break;
      }
    }
  }
  return out.sort((a, b) => a.inDays - b.inDays || a.name.localeCompare(b.name));
}
