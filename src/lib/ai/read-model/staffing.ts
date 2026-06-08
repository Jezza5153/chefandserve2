/**
 * Staffing read-model — the assistant's "what needs me today" + "who fits this shift".
 * Wraps the existing planner-intel + matching engines. Match results carry the FULL chef
 * row (PII + bulk); shapeMatch strips that to brain-safe display fields + the deterministic
 * match signals (score/reasons/warnings) the matching engine already produced.
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, shifts } from "@/lib/db/schema";
import { findMatchesForShift, type MatchResult } from "@/lib/domain/matching";
import { getPlannerCockpit } from "@/lib/domain/planner-intel";
import { estimateMargin } from "@/lib/domain/travel";
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

/** Shift profitability: revenue (client rate) − chef cost over the shift's duration, per
 *  chef and × headcount. Reuses the shared estimateMargin (tone ok/low/negative). null if
 *  the shift is gone; `priced:false` if rates aren't filled in. */
export async function shiftMargin(shiftId: string) {
  const [s] = await db
    .select({
      id: shifts.id,
      roleNeeded: shifts.roleNeeded,
      headcount: shifts.headcount,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      clientRateCents: shifts.clientRateCents,
      chefRateCents: shifts.chefRateCents,
      companyName: clients.companyName,
    })
    .from(shifts)
    .leftJoin(clients, eq(clients.id, shifts.clientId))
    .where(eq(shifts.id, shiftId))
    .limit(1);
  if (!s) return null;

  const hoursPerChef = Math.max(
    0,
    (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 3_600_000,
  );
  const headcount = s.headcount || 1;
  const shift = {
    id: s.id,
    role: formatShiftRole(s.roleNeeded),
    client: s.companyName,
    headcount: s.headcount,
    hoursPerChef: Math.round(hoursPerChef * 10) / 10,
  };
  if (s.clientRateCents == null || s.chefRateCents == null) {
    return { shift, priced: false as const };
  }
  const per = estimateMargin({
    clientRateCents: s.clientRateCents,
    chefRateCents: s.chefRateCents,
    hours: hoursPerChef,
    travelCents: 0,
  });
  const toEur = (c: number) => Math.round(c / 100);
  return {
    shift,
    priced: true as const,
    tone: per.tone,
    perChef: {
      revenueEur: toEur(per.revenueCents),
      chefCostEur: toEur(per.chefCostCents),
      marginEur: toEur(per.marginCents),
    },
    total: {
      revenueEur: toEur(per.revenueCents * headcount),
      chefCostEur: toEur(per.chefCostCents * headcount),
      marginEur: toEur(per.marginCents * headcount),
    },
  };
}
