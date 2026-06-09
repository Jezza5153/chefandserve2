/**
 * Intel read-models for the owner assistant — PR-INTEL-P4. Wrap the hardened
 * domain intel (src/lib/domain/intel.ts) into AI-consumable shapes: roles
 * humanised, cents → whole euros, the manual "Maarten brein" + AI pair-summary
 * passed straight through. No fabrication — every field is observed, captured, or
 * Maarten-written. Tools call THESE, not the domain directly.
 */
import {
  getChefIntelSnapshot,
  getClientIntelSnapshot,
  getMatchIntel,
} from "@/lib/domain/intel";
import { formatChefRole } from "@/lib/labels";

/** Full intel on one chef — judgment + patterns + decline signals + reactivation. */
export async function chefIntelForAi(chefId: string) {
  const s = await getChefIntelSnapshot(chefId);
  if (!s) return null;
  return {
    brein: s.brein, // best ingezet voor / risico / volgende actie … (human text already)
    busiestDay: s.patterns.busiestDayLabel,
    topDaypart: s.patterns.topDaypart,
    topRoles: s.patterns.roleMix.map((r) => ({ rol: formatChefRole(r.role), aantal: r.count })),
    earningsPerClient: s.patterns.clientEarnings.map((c) => ({
      klant: c.name,
      verdiendEur: Math.round(c.cents / 100),
      diensten: c.shifts,
    })),
    totalEarnedEur: Math.round(s.patterns.totalEarnedCents / 100),
    earned30dEur: Math.round(s.patterns.earned30dCents / 100),
    declineSignals: s.declineSignals.map((d) => ({ reden: d.label, aantal: d.count })),
    daysSinceLastWorked: s.daysSinceLastWorked,
  };
}
export type ChefIntelForAi = NonNullable<Awaited<ReturnType<typeof chefIntelForAi>>>;

/** Full intel on one klant — judgment + booking patterns + repeat chefs. */
export async function clientIntelForAi(clientId: string) {
  const s = await getClientIntelSnapshot(clientId);
  if (!s) return null;
  return {
    brein: s.brein, // beste chef-type / waar ze om geven / risico / volgende actie
    busiestBookingDay: s.patterns.busiestDayLabel,
    topRoles: s.patterns.roleMix.map((r) => ({ rol: formatChefRole(r.role), aantal: r.count })),
    repeatChefs: s.patterns.repeatChefs.map((c) => ({ chef: c.name, diensten: c.count })),
  };
}
export type ClientIntelForAi = NonNullable<Awaited<ReturnType<typeof clientIntelForAi>>>;

/** The chef×klant fit — derived history + post-shift thumbs + pair-memory + AI why. */
export async function matchIntelForAi(chefId: string, clientId: string) {
  const m = await getMatchIntel(chefId, clientId);
  return {
    samengewerkt: m.history.completedShifts,
    laatstGewerkt: m.history.lastWorkedAt,
    klantBeoordeling: m.history.ratingForClient,
    favoriet: m.history.isFavorite,
    geblokkeerd: m.history.isBlocked,
    postShiftDuimen: m.thumbs, // { up, down }
    note: m.pair?.note ?? null,
    wouldRehire: m.pair?.wouldRehire ?? null,
    wouldReturn: m.pair?.wouldReturn ?? null,
    aiWhyWorks: m.pair?.aiWhyWorks ?? null,
    aiWhyFails: m.pair?.aiWhyFails ?? null,
  };
}
export type MatchIntelForAi = Awaited<ReturnType<typeof matchIntelForAi>>;
