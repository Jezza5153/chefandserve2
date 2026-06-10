/**
 * Planbord "Vul de week" — auto-draft the week's open slots (PR-PLANBORD-3).
 *
 * Greedy assignment over the SAME matching brain the rail uses
 * (findMatchesForShift): walk the period's shifts earliest-first, and for each
 * open slot pick the best AVAILABLE chef — re-querying per slot so a chef just
 * drafted is excluded from an overlapping slot (the 'draft' conflict wiring) and
 * is never placed twice on one shift. A light fairness tiebreak spreads load:
 * among candidates within 12 pts of the best, take the least-assigned this pass.
 *
 * Picks land as DRAFTS (concepts) — invisible to chef + klant until the planner
 * reviews and hits Publiceer. Deterministic today; the LLM/embedding scorer can
 * swap in behind findMatchesForShift later with NO change here.
 */
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { placements, shifts } from "@/lib/db/schema";
import { draftPlacement, findMatchesForShift } from "@/lib/domain/matching";
import { amsterdamDayKey } from "@/lib/roster-format";

/** Live placements (draft/proposed/accepted/confirmed) per shift — grouped query + Map.
 *  ⚠ Never compute this as a correlated subquery in a select PROJECTION: drizzle+neon-http
 *  renders those uncorrelated (always 0 — verified in the W3 idempotency E2E). */
async function liveCounts(shiftIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (shiftIds.length === 0) return map;
  const counts = await db
    .select({ shiftId: placements.shiftId, n: sql<number>`count(*)::int` })
    .from(placements)
    .where(
      and(
        inArray(placements.shiftId, shiftIds),
        inArray(placements.status, ["draft", "proposed", "accepted", "confirmed"]),
      ),
    )
    .groupBy(placements.shiftId);
  for (const c of counts) map.set(c.shiftId, Number(c.n));
  return map;
}

export type AutofillResult = {
  /** Concepts created this pass. */
  filled: number;
  /** Total open slots in the period before the pass. */
  openSlotsBefore: number;
  /** Distinct shifts that got at least one concept. */
  shiftsTouched: number;
};

export async function autofillWeek(args: {
  startUtc: Date;
  endUtc: Date;
  actorUserId: string;
}): Promise<AutofillResult> {
  const rows = await db
    .select({ id: shifts.id, headcount: shifts.headcount })
    .from(shifts)
    .where(
      and(
        gte(shifts.startsAt, args.startUtc),
        lt(shifts.startsAt, args.endUtc),
        sql`${shifts.status} not in ('cancelled','completed')`,
      ),
    )
    .orderBy(asc(shifts.startsAt));

  // ⚠ Live counts via grouped query + Map — a correlated subquery in the PROJECTION renders
  // uncorrelated (always 0) under drizzle+neon-http, which made autofill non-idempotent and
  // over-fill already-full shifts (found in the W3 idempotency E2E).
  const liveByShift = await liveCounts(rows.map((r) => r.id));

  const openShifts = rows
    .map((s) => ({ id: s.id, open: Math.max(0, s.headcount - (liveByShift.get(s.id) ?? 0)) }))
    .filter((s) => s.open > 0);
  const openSlotsBefore = openShifts.reduce((a, s) => a + s.open, 0);

  let filled = 0;
  const touched = new Set<string>();
  const assigned = new Map<string, number>(); // chefId → # assigned this pass

  for (const shift of openShifts) {
    for (let slot = 0; slot < shift.open; slot++) {
      // Re-query each slot: a chef drafted a moment ago is now excluded from this
      // shift (already-placed) and from any overlapping shift (draft conflict).
      const matches = await findMatchesForShift(shift.id, { limit: 6 });
      if (matches.length === 0) break; // nobody fits this shift right now

      // Fairness: within 12 pts of the best, prefer the least-loaded chef.
      const best = matches[0].score;
      const band = matches.filter((m) => m.score >= best - 12);
      band.sort((a, b) => (assigned.get(a.chef.id) ?? 0) - (assigned.get(b.chef.id) ?? 0));
      const pick = band[0];

      const res = await draftPlacement(shift.id, pick.chef.id, {
        proposedBy: args.actorUserId,
        matchScore: pick.score,
      });
      if (res.status !== "draft") break; // already placed (defensive) — next shift
      filled++;
      touched.add(shift.id);
      assigned.set(pick.chef.id, (assigned.get(pick.chef.id) ?? 0) + 1);
    }
  }

  return { filled, openSlotsBefore, shiftsTouched: touched.size };
}

/* ----- "Kopieer vorige week" (PR-PLANBORD-9) ------------------------------- */

/** Amsterdam weekday (0=Sun … 6=Sat) — same for a shift and its −7d twin. */
function amsWeekday(d: Date | string): number {
  return new Date(`${amsterdamDayKey(d)}T12:00:00Z`).getUTCDay();
}

export type CopyResult = {
  /** Concepts created from last week. */
  filled: number;
  /** Distinct shifts that got at least one concept. */
  matchedShifts: number;
  /** Open slots in the period before the copy. */
  openSlotsBefore: number;
};

/**
 * Seed this week's open slots from LAST week's roster: for each open shift, find
 * last week's placement(s) on the same (klant, weekday, rol) and draft that chef
 * as a CONCEPT — the "same chef every Friday at Hotel X" pattern. Drafts only;
 * publish re-validates (a chef now blocked / double-booked is skipped there).
 */
export async function copyLastWeek(args: {
  startUtc: Date;
  endUtc: Date;
  actorUserId: string;
}): Promise<CopyResult> {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const prevStart = new Date(args.startUtc.getTime() - WEEK_MS);
  const prevEnd = new Date(args.endUtc.getTime() - WEEK_MS);

  // This week's shifts that still have open slots.
  const thisRows = await db
    .select({
      id: shifts.id,
      clientId: shifts.clientId,
      startsAt: shifts.startsAt,
      roleNeeded: shifts.roleNeeded,
      headcount: shifts.headcount,
    })
    .from(shifts)
    .where(
      and(
        gte(shifts.startsAt, args.startUtc),
        lt(shifts.startsAt, args.endUtc),
        sql`${shifts.status} not in ('cancelled','completed')`,
      ),
    )
    .orderBy(asc(shifts.startsAt));

  // Same projection-subquery fix as autofillWeek — grouped counts via liveCounts().
  const liveByShift = await liveCounts(thisRows.map((r) => r.id));

  const openShifts = thisRows
    .map((s) => ({
      id: s.id,
      key: `${s.clientId}|${amsWeekday(s.startsAt)}|${s.roleNeeded}`,
      open: Math.max(0, s.headcount - (liveByShift.get(s.id) ?? 0)),
    }))
    .filter((s) => s.open > 0);
  const openSlotsBefore = openShifts.reduce((a, s) => a + s.open, 0);
  if (openShifts.length === 0) return { filled: 0, matchedShifts: 0, openSlotsBefore: 0 };

  // Last week: who worked what (klant, weekday, rol) → ordered chef list.
  const prevRows = await db
    .select({
      chefId: placements.chefId,
      clientId: shifts.clientId,
      startsAt: shifts.startsAt,
      roleNeeded: shifts.roleNeeded,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .where(
      and(
        gte(shifts.startsAt, prevStart),
        lt(shifts.startsAt, prevEnd),
        inArray(placements.status, ["proposed", "accepted", "confirmed", "completed"]),
      ),
    );

  const byKey = new Map<string, string[]>();
  for (const r of prevRows) {
    const key = `${r.clientId}|${amsWeekday(r.startsAt)}|${r.roleNeeded}`;
    const arr = byKey.get(key) ?? [];
    if (!arr.includes(r.chefId)) arr.push(r.chefId);
    byKey.set(key, arr);
  }

  let filled = 0;
  const matched = new Set<string>();
  for (const s of openShifts) {
    let slotsLeft = s.open;
    for (const chefId of byKey.get(s.key) ?? []) {
      if (slotsLeft <= 0) break;
      const res = await draftPlacement(s.id, chefId, { proposedBy: args.actorUserId });
      if (res.status === "draft") {
        filled++;
        slotsLeft--;
        matched.add(s.id);
      }
    }
  }
  return { filled, matchedShifts: matched.size, openSlotsBefore };
}
