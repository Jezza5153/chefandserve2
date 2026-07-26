/**
 * Staffing read-model — the assistant's "what needs me today" + "who fits this shift".
 * Wraps the existing planner-intel + matching engines. Match results carry the FULL chef
 * row (PII + bulk); shapeMatch strips that to brain-safe display fields + the deterministic
 * match signals (score/reasons/warnings) the matching engine already produced.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefAvailability, chefs, clients, placements, shifts } from "@/lib/db/schema";
import {
  findMatchesForShift,
  scoreChefForShift,
  type MatchResult,
} from "@/lib/domain/matching";
import { getPlannerCockpit } from "@/lib/domain/planner-intel";
import { estimateMargin } from "@/lib/domain/travel";
import { getMoneyAssumptions } from "@/lib/business-settings";
import { formatChefRole, formatShiftRole } from "@/lib/labels";

function shapeMatch(m: MatchResult) {
  return {
    chefId: m.chef.id,
    chefName: m.chef.fullName,
    vakniveau: formatChefRole(m.chef.vakniveau),
    city: m.chef.city,
    // CHEF-CTA: when the assistant FINDS a chef, the answer must end in an action —
    // "bel of app 'm nu". These shapes feed OWNER/PLANNER-only tools (suggest_chefs /
    // match_requirement / planner.cockpit — portal registries never see them), and the
    // playbook prints the number on the web channel only. Phone is not a BSN/IBAN-class
    // value, but it IS personal data: never let these shapes reach a klant/chef surface.
    phone: m.chef.phone,
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
    // W1: the cockpit now suggests for the top 3 urgent shifts; the tool surfaces them all
    // (and keeps `topMatch` as the first entry for prompt/back-compat).
    topMatches: c.topMatches.map((tm) => ({
      shift: {
        shiftId: tm.shift.id,
        client: tm.shift.clientName,
        role: formatShiftRole(tm.shift.roleNeeded),
        startsAt: tm.shift.startsAt,
        open: tm.shift.open,
      },
      suggestions: tm.matches.map(shapeMatch),
    })),
    topMatch: c.topMatches[0]
      ? {
          shift: {
            shiftId: c.topMatches[0].shift.id,
            client: c.topMatches[0].shift.clientName,
            role: formatShiftRole(c.topMatches[0].shift.roleNeeded),
            startsAt: c.topMatches[0].shift.startsAt,
            open: c.topMatches[0].shift.open,
          },
          suggestions: c.topMatches[0].matches.map(shapeMatch),
        }
      : null,
    // W1 work-queues — the assistant can now answer "wat moet ik bevestigen / wie is stil?".
    // Humanized like the rest of this read-model: no raw enum labels reach the model.
    toConfirm: c.toConfirm.map((p) => ({ ...p, roleNeeded: formatShiftRole(p.roleNeeded) })),
    awaitingChef: c.awaitingChef.map((p) => ({ ...p, roleNeeded: formatShiftRole(p.roleNeeded) })),
    pendingChangeRequests: c.pendingChangeRequests.map((r) => ({
      ...r,
      kind: r.kind === "cancel" ? "annulering" : "wijziging",
    })),
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
  // CONTRIBUTIEMARGE-INDICATIE: the raw rate spread overstated margin by the
  // werkgeverslasten (sociale premies, vakantiegeld, pensioen) — exactly while the
  // owner is calibrating pricing. Uplift the chef cost by the owner-tuned assumption
  // (money-assumptions page) — but ONLY for payroll: a zzp chef invoices, the agency
  // carries no premies. When every confirmed chef on the shift is zzp, no uplift.
  // Still an INDICATIE: travel/no-show/bad debt excluded — see docs/METRICS.md.
  const assumptions = await getMoneyAssumptions();
  const placedTypes = await db
    .select({ employmentType: chefs.employmentType })
    .from(placements)
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .where(and(eq(placements.shiftId, shiftId), inArray(placements.status, ["accepted", "confirmed", "completed"])));
  const allZzp = placedTypes.length > 0 && placedTypes.every((r) => r.employmentType === "zzp");
  const basis = allZzp
    ? "zzp — geen werkgeverslasten toegepast"
    : `incl. ${assumptions.employerChargesPct}% werkgeverslasten (payroll-aanname)`;
  const chefRateLoaded = allZzp
    ? s.chefRateCents
    : Math.round(s.chefRateCents * (1 + assumptions.employerChargesPct / 100));
  const per = estimateMargin({
    clientRateCents: s.clientRateCents,
    chefRateCents: chefRateLoaded,
    hours: hoursPerChef,
    travelCents: 0,
  });
  const toEur = (c: number) => Math.round(c / 100);
  return {
    shift,
    priced: true as const,
    basis,
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

/* ============================================================================
 * chefs.match_requirement — rank chefs against a REQUIREMENT, with no shift row.
 *
 * findMatchesForShift(shiftId) was the only scored entry point, so the assistant could
 * only rank chefs for work that already existed in the database. Maarten exploring
 * ("wie kan zaterdag in Rotterdam patisserie?") had no tool at all and fell back to a
 * rating-sorted substring list.
 *
 * Nothing is re-implemented here: scoreChefForShift(chef, shift) is already pure over a
 * ScorableShift literal, so this builds that literal from the requirement and reuses the
 * exact same weights, reasons and warnings the shift path produces.
 *
 * The other half is the near-miss tier. findMatchesForShift discards excluded candidates
 * inside its loop, so "geen passende chefs" dead-ends and Maarten has to guess which
 * constraint to drop. Here every exclusion is recorded WITH its cause and returned, so the
 * answer can be "0 voldoen aan alles; 3 behalve beschikbaarheid".
 * ========================================================================== */

export type ChefRequirement = {
  /** vakniveau key — the one genuinely required field (it is the scorer's hard gate). */
  roleNeeded: string;
  /** ISO date (YYYY-MM-DD). Enables the availability-block and double-booking checks. */
  date?: string;
  city?: string;
  segment?: string;
  minExperience?: number;
  languageRequired?: string;
  maxRateCents?: number;
  skillTags?: string[];
  /** Applies this klant's favourite/blocked lists and their venue coordinates. */
  clientId?: string;
  limit?: number;
};

export type RequirementMatch = ReturnType<typeof shapeMatch>;
export type NearMiss = { chefId: string; chefName: string; blockedBy: string };

const REASON_LABEL: Record<string, string> = {
  vakniveau: "verkeerd vakniveau",
  city: "woont niet in de gevraagde plaats",
  skills: "mist de gevraagde vaardigheid",
  availability: "die dag geblokkeerd",
  doubleBooked: "al ingepland op een overlappende dienst",
  rate: "tarief boven het budget",
  language: "spreekt de gevraagde taal niet",
  experience: "te weinig jaren ervaring",
};

export async function matchChefsToRequirement(req: ChefRequirement): Promise<{
  matches: RequirementMatch[];
  nearMisses: NearMiss[];
  notes: string[];
}> {
  const notes: string[] = [];
  const limit = Math.min(Math.max(req.limit ?? 8, 1), 20);
  const tags = req.skillTags?.filter(Boolean) ?? [];

  // The klant's own signals, when the requirement is tied to one.
  let client: { favoriteChefIds: string[] | null; blockedChefIds: string[] | null } | null = null;
  // Coordinates live on SHIFTS (geocoded from the klant address), not on clients. With no
  // shift row we borrow the klant's most recent geocoded shift — same venue, so it is a fair
  // stand-in for the travel-radius check. Without it, radius simply does not apply.
  let venue: { latitude: string | null; longitude: string | null } = { latitude: null, longitude: null };
  if (req.clientId) {
    const [c] = await db
      .select({ favoriteChefIds: clients.favoriteChefIds, blockedChefIds: clients.blockedChefIds })
      .from(clients)
      .where(eq(clients.id, req.clientId))
      .limit(1);
    client = c ?? null;

    const [v] = await db
      .select({ latitude: shifts.latitude, longitude: shifts.longitude })
      .from(shifts)
      .where(and(eq(shifts.clientId, req.clientId), sql`${shifts.latitude} is not null`))
      .orderBy(desc(shifts.startsAt))
      .limit(1);
    if (v) venue = v;
  }

  // Only the universal predicates go into SQL. Every REQUIREMENT is applied in the loop
  // below, on purpose: a chef filtered out by SQL can never appear as a near-miss, and the
  // near-miss tier is the whole point of this tool — an empty result must be able to say
  // WHICH constraint emptied it. At a few hundred chefs the extra rows are free; if the
  // roster grows past a few thousand, push city/skillTags back into SQL and accept that
  // those two stop being reportable.
  const candidates = await db
    .select()
    .from(chefs)
    .where(and(isNull(chefs.deletedAt), sql`${chefs.status} in ('active', 'onboarding')`));
  if (candidates.length === 0) {
    return { matches: [], nearMisses: [], notes: ["Er zijn geen inzetbare chefs in het bestand."] };
  }

  // Availability + double-booking only mean anything once we know the day.
  const blockedSet = new Set<string>();
  const conflictSet = new Set<string>();
  const day = req.date?.slice(0, 10);
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const blocked = await db
      .select({ chefId: chefAvailability.chefId })
      .from(chefAvailability)
      .where(and(sql`${chefAvailability.date} = ${day}::date`, eq(chefAvailability.available, false)));
    for (const r of blocked) blockedSet.add(r.chefId);

    // Whole-day overlap: we have no clock times on a bare requirement, so any live
    // placement that day counts as a conflict. Deliberately conservative.
    const conflicts = await db
      .select({ chefId: placements.chefId })
      .from(placements)
      .innerJoin(shifts, eq(shifts.id, placements.shiftId))
      .where(
        and(
          inArray(placements.status, ["draft", "accepted", "confirmed"]),
          sql`${shifts.startsAt}::date = ${day}::date`,
        ),
      );
    for (const r of conflicts) conflictSet.add(r.chefId);

    notes.push(
      "Beschikbaarheid sluit alleen chefs uit die die dag zélf geblokkeerd hebben — géén blokkade betekent 'niet bekend', niet 'zeker vrij'.",
    );
  } else if (req.date) {
    notes.push(`Kon niet op beschikbaarheid filteren: "${req.date}" is geen geldige datum.`);
  }

  // The literal the pure scorer already understands.
  const scorable = {
    roleNeeded: req.roleNeeded,
    segment: req.segment ?? null,
    city: req.city ?? null,
    minExperience: req.minExperience ?? null,
    languageRequired: req.languageRequired ?? null,
    latitude: venue.latitude,
    longitude: venue.longitude,
  };

  const favourite = new Set(client?.favoriteChefIds ?? []);
  const blockedByKlant = new Set(client?.blockedChefIds ?? []);

  const scored: { chef: (typeof candidates)[number]; score: number; reasons: string[]; warnings: string[] }[] = [];
  const nearMisses: NearMiss[] = [];

  for (const chef of candidates) {
    const drop = (why: keyof typeof REASON_LABEL) => {
      nearMisses.push({ chefId: chef.id, chefName: chef.fullName, blockedBy: REASON_LABEL[why] });
    };

    if (blockedByKlant.has(chef.id)) {
      nearMisses.push({ chefId: chef.id, chefName: chef.fullName, blockedBy: "door deze klant geblokkeerd" });
      continue;
    }
    if (blockedSet.has(chef.id)) { drop("availability"); continue; }
    if (conflictSet.has(chef.id)) { drop("doubleBooked"); continue; }

    if (req.city?.trim() && !(chef.city ?? "").toLowerCase().includes(req.city.trim().toLowerCase())) {
      drop("city"); continue;
    }
    if (tags.length && !(chef.skillTags ?? []).some((t) => tags.includes(t))) {
      drop("skills"); continue;
    }

    // Missing data must never read as "meets the requirement". If we cannot verify a hard
    // constraint we keep the chef but flag it, rather than silently passing them (the bug
    // in the shift path, where a chef with no languages recorded passes a language
    // requirement without even a warning).
    const unverified: string[] = [];

    if (typeof req.maxRateCents === "number") {
      if (chef.hourlyRateMinCents == null) unverified.push("tarief onbekend");
      else if (chef.hourlyRateMinCents > req.maxRateCents) { drop("rate"); continue; }
    }

    if (typeof req.minExperience === "number") {
      if (chef.yearsExperience == null) unverified.push("ervaring onbekend");
      else if (chef.yearsExperience < req.minExperience) { drop("experience"); continue; }
    }

    if (req.languageRequired?.trim()) {
      const want = req.languageRequired.trim().toLowerCase();
      const langs = (chef.languages ?? []).map((l) => l.toLowerCase());
      if (langs.length === 0) unverified.push("talen niet ingevuld");
      else if (!langs.some((l) => l.includes(want) || want.includes(l))) { drop("language"); continue; }
    }

    const { score, reasons, warnings } = scoreChefForShift(chef, scorable);
    // score 0 means the vakniveau gate rejected them — same rule findMatchesForShift uses.
    if (score <= 0) { drop("vakniveau"); continue; }

    scored.push({
      chef,
      score: favourite.has(chef.id) ? Math.min(100, Math.round(score * 1.1)) : score,
      reasons,
      warnings: unverified.length ? [...warnings, `Niet te toetsen: ${unverified.join(', ')}`] : warnings,
    });
  }

  scored.sort((a, b) => b.score - a.score || (b.chef.ratingCount ?? 0) - (a.chef.ratingCount ?? 0) || a.chef.fullName.localeCompare(b.chef.fullName));

  if (typeof req.maxRateCents === "number") {
    notes.push("Chefs zonder tarief in het profiel zijn niet op budget getoetst — zie hun waarschuwing.");
  }

  return {
    matches: scored.slice(0, limit).map((m) => shapeMatch({ chef: m.chef, score: m.score, reasons: m.reasons, warnings: m.warnings } as MatchResult)),
    nearMisses: nearMisses.slice(0, 12),
    notes,
  };
}
