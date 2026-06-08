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
import { and, asc, gte, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { shifts } from "@/lib/db/schema";
import { draftPlacement, findMatchesForShift } from "@/lib/domain/matching";

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
    .select({
      id: shifts.id,
      headcount: shifts.headcount,
      liveCount: sql<number>`(select count(*) from placements p where p.shift_id = ${shifts.id} and p.status in ('draft','proposed','accepted','confirmed'))::int`,
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

  const openShifts = rows
    .map((s) => ({ id: s.id, open: Math.max(0, s.headcount - s.liveCount) }))
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
