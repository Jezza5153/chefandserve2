/**
 * Staffing read-model — the assistant's "what needs me today" + "who fits this shift".
 * Wraps the existing planner-intel + matching engines. Match results carry the FULL chef
 * row (PII + bulk); shapeMatch strips that to brain-safe display fields + the deterministic
 * match signals (score/reasons/warnings) the matching engine already produced.
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { shifts } from "@/lib/db/schema";
import { findMatchesForShift, type MatchResult } from "@/lib/domain/matching";
import { getPlannerCockpit } from "@/lib/domain/planner-intel";
import { formatChefRole, formatShiftRole } from "@/lib/labels";

function shapeMatch(m: MatchResult) {
  return {
    chefId: m.chef.id,
    chefName: m.chef.fullName,
    vakniveau: formatChefRole(m.chef.vakniveau),
    city: m.chef.city,
    score: m.score,
    reasons: m.reasons,
    warnings: m.warnings,
  };
}

export async function plannerCockpit(now: Date) {
  const c = await getPlannerCockpit(now);
  return {
    intake: c.intake,
    acceptedUnconfirmed: c.acceptedUnconfirmed,
    open48hSlots: c.open48hSlots,
    open7dCount: c.open7dCount,
    open48h: c.open48h.map((s) => ({
      shiftId: s.id,
      client: s.clientName,
      role: formatShiftRole(s.roleNeeded),
      startsAt: s.startsAt,
      open: s.open,
      city: s.city,
    })),
    topMatch: c.topMatch
      ? {
          shift: {
            shiftId: c.topMatch.shift.id,
            client: c.topMatch.shift.clientName,
            role: formatShiftRole(c.topMatch.shift.roleNeeded),
            startsAt: c.topMatch.shift.startsAt,
            open: c.topMatch.shift.open,
          },
          suggestions: c.topMatch.matches.map(shapeMatch),
        }
      : null,
  };
}

/** null when the shift doesn't exist — findMatchesForShift throws on a missing shift,
 *  so we guard first and let the tool return a clean "dienst bestaat niet" instead. */
export async function suggestChefsForShift(shiftId: string, limit: number) {
  const [shift] = await db.select({ id: shifts.id }).from(shifts).where(eq(shifts.id, shiftId)).limit(1);
  if (!shift) return null;
  const matches = await findMatchesForShift(shiftId, { limit });
  return matches.map(shapeMatch);
}
