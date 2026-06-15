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
import { createNotification, notifyUser, recordEmailMessage } from "@/lib/integrations";
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

/* ----- PR-2B: chef preference ↔ shift signal (deterministic) -------- */
/**
 * Maps a chef's normalized Jotform preference (PREF_MAP in intake/jotform.ts)
 * to the structured shift signals it satisfies. Preferences with no structured
 * counterpart yet (bbq, flexible) are intentionally absent — we never invent a
 * reason we can't prove from real data.
 */
const PREFERENCE_SIGNALS: Record<
  string,
  { segments?: string[]; clientTypes?: string[]; clientTags?: string[]; label: string }
> = {
  breakfast: { clientTags: ["ontbijt"], label: "ontbijt" },
  banqueting: { segments: ["banqueting"], clientTags: ["banqueting"], label: "banqueting" },
  beachclub: { clientTypes: ["beachclub"], label: "beachclub" },
  early_shifts: { clientTags: ["early_start"], label: "vroege shifts" },
  hotels: { segments: ["hotel"], clientTypes: ["hotel"], label: "hotels" },
  restaurants: { clientTypes: ["restaurant"], label: "restaurants" },
  michelin: { segments: ["michelin"], label: "Michelin" },
};

function matchedPreferenceLabels(
  preferences: string[],
  shift: { segment: string | null; clientType: string | null; clientTags: string[] | null },
): string[] {
  const out: string[] = [];
  for (const pref of preferences) {
    const sig = PREFERENCE_SIGNALS[pref];
    if (!sig) continue;
    const segHit = !!(sig.segments && shift.segment && sig.segments.includes(shift.segment));
    const typeHit = !!(sig.clientTypes && shift.clientType && sig.clientTypes.includes(shift.clientType));
    const tagHit = !!(
      sig.clientTags &&
      shift.clientTags &&
      sig.clientTags.some((t) => shift.clientTags!.includes(t))
    );
    if (segHit || typeHit || tagHit) out.push(sig.label);
  }
  return out;
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
  chef: Pick<
    Chef,
    "vakniveau" | "yearsExperience" | "city" | "status" | "segments" | "languages" | "preferences"
  >,
  shift: {
    roleNeeded: string;
    segment: string | null;
    city: string | null;
    minExperience?: number | null;
    languageRequired?: string | null;
    clientType?: string | null;
    clientTags?: string[] | null;
  },
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

  // PR-2B: shift requirements (the other half of the matching brain).
  if (
    shift.minExperience != null &&
    chef.yearsExperience != null &&
    chef.yearsExperience < shift.minExperience
  ) {
    warnings.push(`Onder gevraagde ervaring (${chef.yearsExperience}j < ${shift.minExperience}j)`);
  }
  if (shift.languageRequired) {
    const langs = (chef.languages ?? []).map((l) => l.toLowerCase());
    const req = shift.languageRequired.toLowerCase();
    if (langs.some((l) => l.includes(req) || req.includes(l))) {
      reasons.push(`Spreekt ${shift.languageRequired}`);
    } else if (langs.length > 0) {
      warnings.push(`Mist gevraagde taal: ${shift.languageRequired}`);
    }
  }

  // PR-2B: chef preference ↔ this shift's segment / klanttype / tags.
  for (const label of matchedPreferenceLabels(chef.preferences ?? [], {
    segment: shift.segment,
    clientType: shift.clientType ?? null,
    clientTags: shift.clientTags ?? null,
  })) {
    reasons.push(`Voorkeur sluit aan: ${label}`);
  }

  return { reasons, warnings };
}

/* ----- CHEF-PR1: score ONE chef against ONE shift (chef-facing) ----------- */

/** Chef fields needed to score a single shift (subset of the full row). */
export type ScorableChef = Pick<
  Chef,
  "vakniveau" | "yearsExperience" | "city" | "status" | "segments" | "languages" | "preferences"
>;

/** Shift fields needed to score + explain a single match. */
export type ScorableShift = {
  roleNeeded: string;
  segment: string | null;
  city: string | null;
  minExperience?: number | null;
  languageRequired?: string | null;
  clientType?: string | null;
  clientTags?: string[] | null;
};

export type ChefShiftScore = {
  /** 0-100 composite, SAME formula as findMatchesForShift. */
  score: number;
  /** Klant-safe positive reasons ("Waarom krijg ik deze shift?"). */
  reasons: string[];
  /** Internal-only warnings — never render to chef OR klant. */
  warnings: string[];
};

/**
 * Score one chef against one shift, reusing the exact scoring helpers +
 * weights that findMatchesForShift uses (vakniveau 0.5 · segment 0.3 ·
 * experience 0.2). Pure + synchronous so the open-shifts list can call it per
 * row without extra DB round-trips. Powers the chef-facing fit% + "waarom" on
 * /chef/open (CHEF-PR1). Stable signature so AI/Phase-9 can swap the scorer.
 */
export function scoreChefForShift(
  chef: ScorableChef,
  shift: ScorableShift,
): ChefShiftScore {
  const v = vakniveauScore(chef.vakniveau, shift.roleNeeded);
  const s = segmentScore(chef.segments, shift.segment);
  const e = experienceBonus(chef.yearsExperience, shift.segment);
  const composite = v * 0.5 + s * 0.3 + e * 0.2;
  const score = Math.round(composite * 100);
  const { reasons, warnings } = buildReasonsAndWarnings(chef, shift, v, s);
  return { score, reasons, warnings };
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
      chefLanguages: chefs.languages,
      chefPreferences: chefs.preferences,
      shiftRole: shifts.roleNeeded,
      shiftSegment: shifts.segment,
      shiftCity: shifts.city,
      shiftMinExperience: shifts.minExperience,
      shiftLanguageRequired: shifts.languageRequired,
      clientType: clients.clientType,
      clientTags: clients.clientTags,
    })
    .from(placements)
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .leftJoin(clients, eq(clients.id, shifts.clientId))
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
      languages: row.chefLanguages,
      preferences: row.chefPreferences,
    },
    {
      roleNeeded: row.shiftRole,
      segment: row.shiftSegment,
      city: row.shiftCity,
      minExperience: row.shiftMinExperience,
      languageRequired: row.shiftLanguageRequired,
      clientType: row.clientType,
      clientTags: row.clientTags,
    },
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

  // PR-2B: klanttype + tags feed the preference-match reasons.
  const matchClient = await db.query.clients.findFirst({
    where: eq(clients.id, shift.clientId),
  });

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
        // a live status — OR a "draft" already placed onto this shift — blocks re-proposal
        inArray(placements.status, ["draft", "proposed", "accepted", "confirmed", "completed"]),
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
        // PR-PLANBORD-1: a "draft" tentatively occupies the chef's time too, so an
        // overlapping concept excludes them from suggestions (no self-double-booking).
        inArray(placements.status, ["draft", "accepted", "confirmed"]),
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

    const { reasons, warnings } = buildReasonsAndWarnings(
      chef,
      {
        roleNeeded: shift.roleNeeded,
        segment: shift.segment,
        city: shift.city,
        minExperience: shift.minExperience,
        languageRequired: shift.languageRequired,
        clientType: matchClient?.clientType ?? null,
        clientTags: matchClient?.clientTags ?? null,
      },
      v,
      s,
    );

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

/** Outcome of {@link proposePlacement}. `already_proposed` means a live
 * (proposed/accepted/confirmed) row already exists — nothing changed, no
 * second notification fires. `proposed` covers a fresh row AND a re-proposal
 * that reset a prior rejected/cancelled row back to `proposed`. */
export type ProposeResult = {
  placementId: string;
  status: "proposed" | "already_proposed";
};

/**
 * Propose a chef for a shift. IDEMPOTENT against the
 * `placements_chef_shift_unique` (chefId, shiftId) index — re-proposing must
 * never crash the server action:
 *
 *   - No row yet            → insert a fresh `proposed` row.
 *   - Prior rejected/cancelled row → RESET it back to `proposed` (clear the
 *     responded/confirmed/cancelled stamps, refresh proposedAt/proposedBy/
 *     matchScore/notes) via `onConflictDoUpdate`.
 *   - Prior active row (proposed/accepted/confirmed) → no-op, returns
 *     `already_proposed` so the caller can show a friendly "al voorgesteld"
 *     message instead of throwing on the unique constraint.
 *
 * Notifications (chef + klant) only fire when a NEW proposal is actually made.
 */
export async function proposePlacement(
  shiftId: string,
  chefId: string,
  options: { proposedBy: string; matchScore?: number; notes?: string },
): Promise<ProposeResult> {
  // Friendly guard: a still-active row means the chef is already on the table
  // for this shift. Don't reset it, don't notify twice — just report it back.
  const existing = await db
    .select({ id: placements.id, status: placements.status })
    .from(placements)
    .where(and(eq(placements.shiftId, shiftId), eq(placements.chefId, chefId)))
    .limit(1);
  if (
    existing.length > 0 &&
    ["proposed", "accepted", "confirmed"].includes(existing[0].status)
  ) {
    return { placementId: existing[0].id, status: "already_proposed" };
  }

  const now = new Date();
  // CHEF-PR2 offer lifecycle: the proposal stays open for OFFER_EXPIRY_HOURS
  // (default 24); past that while still 'proposed' it reads as "verlopen".
  const expiresAt = new Date(now.getTime() + (Number(env.OFFER_EXPIRY_HOURS) || 24) * 3_600_000);
  // Insert-or-reset on the unique (chefId, shiftId) target. A prior
  // rejected/cancelled row is reset to a clean `proposed` state; concurrent
  // inserts converge on the same row instead of throwing 23505.
  const [placement] = await db
    .insert(placements)
    .values({
      shiftId,
      chefId,
      status: "proposed",
      proposedBy: options.proposedBy,
      matchScore: options.matchScore ?? null,
      notes: options.notes ?? null,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [placements.chefId, placements.shiftId],
      set: {
        status: "proposed",
        proposedAt: now,
        proposedBy: options.proposedBy,
        matchScore: options.matchScore ?? null,
        notes: options.notes ?? null,
        // Clear the prior lifecycle stamps so the timeline restarts cleanly.
        respondedAt: null,
        confirmedAt: null,
        cancelledAt: null,
        completedAt: null,
        // A fresh offer is unseen again, with a fresh deadline.
        seenAt: null,
        expiresAt,
        updatedAt: now,
      },
    })
    .returning({ id: placements.id });

  // Move shift to "open" if it was still in "request"
  await db
    .update(shifts)
    .set({ status: "open", updatedAt: new Date() })
    .where(and(eq(shifts.id, shiftId), eq(shifts.status, "request")));

  // Best-effort notifications, extracted to sendProposalNotifications() so the
  // planbord "Publiceer" path fires the EXACT same chef + klant mails on publish.
  await sendProposalNotifications(placement.id).catch((e) =>
    console.error("[propose] notification(s) failed:", e),
  );

  return { placementId: placement.id, status: "proposed" };
}

/**
 * Fire the proposal notifications for ONE placement: the chef's invitation mail,
 * the klant's "voorgestelde chef" mail (via recipientsForClient), and the klant
 * in-app notification — each tracked with recordEmailMessage. Extracted from
 * proposePlacement so the planbord "Publiceer" path (publishDraftsForPeriod) sends
 * the IDENTICAL mails when a draft flips → proposed. Best-effort: callers wrap in
 * `.catch` — a mail failure must never roll back the placement.
 */
export async function sendProposalNotifications(placementId: string): Promise<void> {
  const placement = await db.query.placements.findFirst({ where: eq(placements.id, placementId) });
  if (!placement) return;
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, placement.chefId) });
  const shift = await db.query.shifts.findFirst({ where: eq(shifts.id, placement.shiftId) });
  if (!shift) return;
  const client = await db.query.clients.findFirst({ where: eq(clients.id, shift.clientId) });

  // 1. Chef email
  if (chef?.email) {
    const placementUrl = `${env.NEXT_PUBLIC_APP_URL}/chef/shifts/${placementId}`;
    const send = await sendEmail({
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
    // PR-AUDIT-4: track the chef-proposal send (parity with the klant email).
    if (send.ok) {
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: chef.email,
        template: "ShiftProposedEmail",
        eventKey: "shift_proposed",
        entityType: "placements",
        entityId: placementId,
        userId: chef.userId ?? undefined,
      });
    }
  }

  // 1b. Chef in-app + phone (CHEF-14/15): the new-shift alert lands on their
  //     phone (push + WhatsApp are dark until their flags; the bell always lands).
  if (chef?.userId) {
    await notifyUser({
      userId: chef.userId,
      type: "shift_proposed",
      title: `Nieuwe shift bij ${client?.companyName ?? "een klant"}`,
      body: `${shift.roleNeeded} — ${formatShiftWhen(shift.startsAt, shift.endsAt)}`,
      actionUrl: `/chef/shifts/${placementId}`,
      entityType: "placements",
      entityId: placementId,
      push: true,
      whatsapp: {
        template: "chef_nieuwe_dienst",
        params: {
          voornaam: (chef.fullName ?? "chef").split(" ")[0],
          klant: client?.companyName ?? "een klant",
          datum: formatShiftWhen(shift.startsAt, shift.endsAt),
        },
      },
    });
  }

  // 2. Klant email + notification (PR-KLANT-3) — they see the proposed chef on
  //    the hub and can send a comment before it's confirmed.
  if (client) {
    const hubUrl = `${env.NEXT_PUBLIC_APP_URL}/client/shifts/${shift.id}`;
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
            entityId: placementId,
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
        actionUrl: `/client/shifts/${shift.id}`,
        entityType: "placements",
        entityId: placementId,
      });
    }
  }
}

/**
 * Planbord "concept" insert — place a chef onto a shift as a private DRAFT.
 * Same idempotent conflict-safety as proposePlacement (the unique (chefId,
 * shiftId) index) but: status = 'draft', NO notifications, NO shift recompute —
 * a draft is invisible to chef + klant and to shift-status until "Publiceer".
 * Refuses to overwrite a live (proposed/accepted/confirmed) row.
 */
export type DraftResult = { placementId: string; status: "draft" | "already_active" };

export async function draftPlacement(
  shiftId: string,
  chefId: string,
  options: { proposedBy: string; matchScore?: number; notes?: string },
): Promise<DraftResult> {
  const existing = await db
    .select({ id: placements.id, status: placements.status })
    .from(placements)
    .where(and(eq(placements.shiftId, shiftId), eq(placements.chefId, chefId)))
    .limit(1);
  if (existing.length > 0 && ["proposed", "accepted", "confirmed"].includes(existing[0].status)) {
    return { placementId: existing[0].id, status: "already_active" };
  }

  const now = new Date();
  const [placement] = await db
    .insert(placements)
    .values({
      shiftId,
      chefId,
      status: "draft",
      proposedBy: options.proposedBy,
      matchScore: options.matchScore ?? null,
      notes: options.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [placements.chefId, placements.shiftId],
      set: {
        status: "draft",
        proposedBy: options.proposedBy,
        matchScore: options.matchScore ?? null,
        notes: options.notes ?? null,
        // Re-drafting a prior rejected/cancelled row clears its lifecycle stamps.
        respondedAt: null,
        confirmedAt: null,
        cancelledAt: null,
        completedAt: null,
        updatedAt: now,
      },
    })
    .returning({ id: placements.id });

  return { placementId: placement.id, status: "draft" };
}
