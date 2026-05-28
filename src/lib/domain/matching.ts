/**
 * Smart-match v1 — rule-based scoring (no AI yet).
 *
 * Score = vakniveau_match × segment_overlap × availability × experience_bonus
 *
 * Returns top N chefs ranked by score for a given shift. Each result includes
 * a reasoning string so Maarten understands WHY a chef is suggested.
 *
 * Phase 9 will plug in an LLM/embedding-based scorer here while keeping the
 * function signature stable — UI never changes when AI ships.
 */

import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  chefAvailability,
  chefs,
  clients,
  placements,
  shifts,
  type Chef,
} from "@/lib/db/schema";
import { recipientsForClient } from "@/lib/domain/client-recipients";
import { sendEmail, formatShiftWhen } from "@/lib/email";
import { env } from "@/lib/env";
import { createNotification, recordEmailMessage } from "@/lib/integrations";
import { ChefProposedKlantEmail } from "@/emails/ChefProposedKlantEmail";
import { ShiftProposedEmail } from "@/emails/ShiftProposedEmail";

/* ----- ladder (used for vakniveau scoring) -------------------------- */
/** Higher index = more senior. Same level = perfect match. */
const VAKNIVEAU_LADDER = [
  "keukenhulp",
  "commis",
  "chef_de_partie",
  "sous_chef",
  "chef_de_cuisine",
  "executive_chef",
] as const;

const BEDIENING_LADDER = ["runner", "host", "bediening"] as const;

const SPECIALISTS = [
  "patissier",
  "banqueting",
  "breakfast",
  "roomservice",
] as const;

/* ----- scoring helpers --------------------------------------------- */

function vakniveauScore(chefLevel: string | null, shiftLevel: string): number {
  if (!chefLevel) return 0;
  if (chefLevel === shiftLevel) return 1.0;

  // Specialists only match their own role exactly
  if (SPECIALISTS.includes(shiftLevel as typeof SPECIALISTS[number])) return 0;
  if (SPECIALISTS.includes(chefLevel as typeof SPECIALISTS[number])) return 0;

  // Bediening ladder
  const bIdxChef = BEDIENING_LADDER.indexOf(chefLevel as typeof BEDIENING_LADDER[number]);
  const bIdxShift = BEDIENING_LADDER.indexOf(shiftLevel as typeof BEDIENING_LADDER[number]);
  if (bIdxChef !== -1 && bIdxShift !== -1) {
    const gap = Math.abs(bIdxChef - bIdxShift);
    return gap === 0 ? 1.0 : gap === 1 ? 0.7 : 0.4;
  }

  // Chef ladder
  const cIdxChef = VAKNIVEAU_LADDER.indexOf(chefLevel as typeof VAKNIVEAU_LADDER[number]);
  const cIdxShift = VAKNIVEAU_LADDER.indexOf(shiftLevel as typeof VAKNIVEAU_LADDER[number]);
  if (cIdxChef !== -1 && cIdxShift !== -1) {
    const gap = cIdxShift - cIdxChef; // positive = chef is junior to shift need
    if (gap === 0) return 1.0;
    if (gap === 1) return 0.7; // overqualified by 1
    if (gap === -1) return 0.5; // chef is 1 level more senior — usually still ok
    return 0.2;
  }

  return 0;
}

function segmentScore(
  chefSegments: string[] | null,
  shiftSegment: string | null,
): number {
  if (!shiftSegment) return 0.5; // no segment specified = neutral
  if (!chefSegments || chefSegments.length === 0) return 0.5;
  return chefSegments.includes(shiftSegment) ? 1.0 : 0.3;
}

function experienceBonus(years: number | null, shiftSegment: string | null): number {
  if (!years) return 0.5;
  // Fine-dining + Michelin demands experience
  if (shiftSegment === "fine_dining" || shiftSegment === "michelin") {
    if (years >= 8) return 1.0;
    if (years >= 5) return 0.8;
    if (years >= 3) return 0.5;
    return 0.3;
  }
  // Other segments — less steep
  if (years >= 5) return 1.0;
  if (years >= 2) return 0.8;
  return 0.6;
}

/**
 * Build the human-readable reasons + warnings for a match. Extracted so both
 * findMatchesForShift (admin scoring) and getMatchReasonsForPlacement (klant
 * "Waarom voorgesteld?") share ONE source of truth.
 *
 * IMPORTANT: `reasons` are klant-safe (positive, clientVisible). `warnings`
 * are INTERNAL only — never render them to a klant.
 */
function buildReasonsAndWarnings(
  chef: Pick<Chef, "vakniveau" | "yearsExperience" | "city" | "status" | "segments">,
  shift: { roleNeeded: string; segment: string | null; city: string | null },
  v: number,
  s: number,
): { reasons: string[]; warnings: string[] } {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (chef.vakniveau === shift.roleNeeded) {
    reasons.push(`Exacte match: ${chef.vakniveau}`);
  } else if (v >= 0.7) {
    reasons.push(`Aansluitend niveau (${chef.vakniveau} ↔ ${shift.roleNeeded})`);
  } else if (v < 0.5) {
    warnings.push(`Vakniveau-gap: chef is ${chef.vakniveau}, shift vraagt ${shift.roleNeeded}`);
  }

  if (s === 1.0 && shift.segment) {
    reasons.push(`Segment-ervaring: ${shift.segment}`);
  } else if (s < 0.5 && shift.segment) {
    warnings.push(`Niet eerder in segment ${shift.segment}`);
  }

  if (chef.yearsExperience && chef.yearsExperience >= 5) {
    reasons.push(`${chef.yearsExperience} jaar ervaring`);
  }

  if (chef.city && shift.city && chef.city.toLowerCase() === shift.city.toLowerCase()) {
    reasons.push(`Zelfde stad (${chef.city})`);
  }

  if (chef.status === "onboarding") {
    warnings.push("Nog in onboarding");
  }

  return { reasons, warnings };
}

/**
 * Klant-facing "Waarom voorgesteld?" reasons for ONE placement. Returns only
 * the positive, clientVisible reasons — never internal warnings. Used by the
 * shift hub (PR-KLANT-3). Stable signature so AI can call it later.
 */
export async function getMatchReasonsForPlacement(
  placementId: string,
): Promise<string[]> {
  const [row] = await db
    .select({
      chefVakniveau: chefs.vakniveau,
      chefYears: chefs.yearsExperience,
      chefCity: chefs.city,
      chefStatus: chefs.status,
      chefSegments: chefs.segments,
      shiftRole: shifts.roleNeeded,
      shiftSegment: shifts.segment,
      shiftCity: shifts.city,
    })
    .from(placements)
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .where(eq(placements.id, placementId))
    .limit(1);
  if (!row) return [];

  const v = vakniveauScore(row.chefVakniveau, row.shiftRole);
  const s = segmentScore(row.chefSegments, row.shiftSegment);
  const { reasons } = buildReasonsAndWarnings(
    {
      vakniveau: row.chefVakniveau,
      yearsExperience: row.chefYears,
      city: row.chefCity,
      status: row.chefStatus,
      segments: row.chefSegments,
    },
    { roleNeeded: row.shiftRole, segment: row.shiftSegment, city: row.shiftCity },
    v,
    s,
  );
  return reasons;
}

/* ----- main matching function -------------------------------------- */

export type MatchResult = {
  chef: Chef;
  score: number; // 0-100
  scoreBreakdown: {
    vakniveau: number;
    segment: number;
    experience: number;
  };
  reasons: string[];
  warnings: string[];
};

/**
 * Find the best chefs for a shift. Filters out:
 *   - Inactive / archived / soft-deleted chefs
 *   - Chefs explicitly blocked on shift date (chef_availability.available=false)
 *   - Chefs already placed on this shift (no double-rows)
 *   - Chefs with conflicting placements on the same day (overlap detection)
 *
 * Ranks remaining chefs by composite score. Returns top `limit` (default 10).
 */
export async function findMatchesForShift(
  shiftId: string,
  options: { limit?: number; includeOverqualified?: boolean } = {},
): Promise<MatchResult[]> {
  const limit = options.limit ?? 10;

  const shift = await db.query.shifts.findFirst({
    where: eq(shifts.id, shiftId),
  });
  if (!shift) throw new Error(`Shift ${shiftId} not found`);

  // 1. Active chefs only (not soft-deleted)
  const candidateChefs = await db
    .select()
    .from(chefs)
    .where(
      and(
        isNull(chefs.deletedAt),
        or(eq(chefs.status, "active"), eq(chefs.status, "onboarding"))!,
      ),
    );

  // 2. Exclude chefs blocked on this date
  const shiftDate = new Date(shift.startsAt);
  shiftDate.setUTCHours(0, 0, 0, 0);
  const blockedRows = await db
    .select({ chefId: chefAvailability.chefId })
    .from(chefAvailability)
    .where(
      and(
        eq(chefAvailability.date, shiftDate),
        eq(chefAvailability.available, false),
      ),
    );
  const blockedSet = new Set(blockedRows.map((r) => r.chefId));

  // 3. Exclude chefs already placed on this shift
  const alreadyPlaced = await db
    .select({ chefId: placements.chefId })
    .from(placements)
    .where(
      and(
        eq(placements.shiftId, shift.id),
        // anything except "rejected" or "cancelled" blocks re-proposal
        inArray(placements.status, ["proposed", "accepted", "confirmed", "completed"]),
      ),
    );
  const placedSet = new Set(alreadyPlaced.map((r) => r.chefId));

  // 4. Exclude chefs with conflicting confirmed placements that overlap in time
  const conflictRows = await db
    .select({ chefId: placements.chefId })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .where(
      and(
        ne(placements.shiftId, shift.id),
        inArray(placements.status, ["accepted", "confirmed"]),
        // shift overlap: not (other.endsAt <= this.startsAt OR other.startsAt >= this.endsAt)
        sql`NOT (${shifts.endsAt} <= ${shift.startsAt} OR ${shifts.startsAt} >= ${shift.endsAt})`,
      ),
    );
  const conflictSet = new Set(conflictRows.map((r) => r.chefId));

  // 5. Score remaining candidates
  const results: MatchResult[] = [];
  for (const chef of candidateChefs) {
    if (blockedSet.has(chef.id)) continue;
    if (placedSet.has(chef.id)) continue;
    if (conflictSet.has(chef.id)) continue;

    const v = vakniveauScore(chef.vakniveau, shift.roleNeeded);
    const s = segmentScore(chef.segments, shift.segment);
    const e = experienceBonus(chef.yearsExperience, shift.segment);

    // Composite — weighted product. Vakniveau is the gate.
    if (v === 0 && !options.includeOverqualified) continue;
    const composite = v * 0.5 + s * 0.3 + e * 0.2;
    const score = Math.round(composite * 100);

    const { reasons, warnings } = buildReasonsAndWarnings(chef, shift, v, s);

    results.push({
      chef,
      score,
      scoreBreakdown: { vakniveau: v, segment: s, experience: e },
      reasons,
      warnings,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Propose a chef for a shift. Creates a placement row, audit-logs, and
 * (eventually) sends a Resend email. Returns the new placement id.
 *
 * Phase 7 wires the email send. For now we create the row + audit and
 * the chef portal (Phase 4) will see the proposal next time they load.
 */
export async function proposePlacement(
  shiftId: string,
  chefId: string,
  options: { proposedBy: string; matchScore?: number; notes?: string },
): Promise<{ placementId: string }> {
  const [placement] = await db
    .insert(placements)
    .values({
      shiftId,
      chefId,
      status: "proposed",
      proposedBy: options.proposedBy,
      matchScore: options.matchScore ?? null,
      notes: options.notes ?? null,
    })
    .returning({ id: placements.id });

  // Move shift to "open" if it was still in "request"
  await db
    .update(shifts)
    .set({ status: "open", updatedAt: new Date() })
    .where(and(eq(shifts.id, shiftId), eq(shifts.status, "request")));

  // Best-effort notifications: chef gets the proposal, klant gets a heads-up.
  // Failure here doesn't abort the placement — admin sees the row regardless.
  try {
    const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, chefId) });
    const shift = await db.query.shifts.findFirst({ where: eq(shifts.id, shiftId) });
    if (!shift) return { placementId: placement.id };

    const client = await db.query.clients.findFirst({
      where: eq(clients.id, shift.clientId),
    });

    // 1. Chef email
    if (chef?.email) {
      const placementUrl = `${env.NEXT_PUBLIC_APP_URL}/chef/shifts/${placement.id}`;
      await sendEmail({
        to: chef.email,
        subject: `Nieuwe shift bij ${client?.companyName ?? "een klant"} — ${shift.roleNeeded}`,
        react: ShiftProposedEmail({
          chefName: chef.fullName,
          clientName: client?.companyName ?? "Onze klant",
          shiftWhen: formatShiftWhen(shift.startsAt, shift.endsAt),
          shiftRole: shift.roleNeeded,
          shiftCity: shift.city,
          shiftRateEur: shift.chefRateCents ? shift.chefRateCents / 100 : null,
          shiftNotes: shift.notes,
          placementUrl,
        }),
      });
    }

    // 2. Klant email + notification (PR-KLANT-3) — they see the proposed chef
    //    on the hub and can send a comment before it's confirmed.
    if (client) {
      const hubUrl = `${env.NEXT_PUBLIC_APP_URL}/client/shifts/${shiftId}`;
      const to = await recipientsForClient(client.id, "chef_proposed");
      if (to.length > 0 && chef) {
        const send = await sendEmail({
          to,
          subject: `Voorgestelde chef voor ${shift.roleNeeded} — ${formatShiftWhen(shift.startsAt, shift.endsAt)}`,
          react: ChefProposedKlantEmail({
            contactName: client.contactName,
            companyName: client.companyName,
            chefName: chef.fullName,
            chefVakniveau: chef.vakniveau,
            chefYears: chef.yearsExperience,
            shiftWhen: formatShiftWhen(shift.startsAt, shift.endsAt),
            shiftRole: shift.roleNeeded,
            hubUrl,
          }),
        });
        if (send.ok) {
          for (const addr of to) {
            await recordEmailMessage({
              providerMessageId: send.id,
              toEmail: addr,
              template: "ChefProposedKlantEmail",
              eventKey: "chef_proposed",
              entityType: "placements",
              entityId: placement.id,
            });
          }
        }
      }
      if (client.userId) {
        await createNotification({
          userId: client.userId,
          type: "chef_proposed",
          title: `Voorgestelde chef voor ${shift.roleNeeded}`,
          body: "Bekijk het voorstel en stuur eventueel een opmerking.",
          actionUrl: `/client/shifts/${shiftId}`,
          entityType: "placements",
          entityId: placement.id,
        });
      }
    }
  } catch (e) {
    console.error("[propose] notification(s) failed:", e);
  }

  return { placementId: placement.id };
}
