/**
 * Shift interests (CHEF-OPEN) — "rooster: vraag een dienst aan".
 *
 * A chef browses OPEN shifts and raises their hand; the planner still curates
 * the actual placement (express-interest, NOT self-assign). Dark behind
 * CHEF_OPEN_SHIFTS_ENABLED. Open-headcount uses a GROUPED query + Map (never a
 * projection subquery — neon-http renders those uncorrelated).
 */
import { and, asc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  chefAvailability,
  chefs,
  clients,
  placements,
  shiftInterests,
  shifts,
  users,
} from "@/lib/db/schema";
import { type LatLng } from "@/lib/domain/geo";
import { scoreChefForShift } from "@/lib/domain/matching";
import { estimateTravel, type TransportMode } from "@/lib/domain/travel";
import { env } from "@/lib/env";
import { createNotification } from "@/lib/integrations";
import { amsterdamDayKey } from "@/lib/roster-format";

/** Parse a numeric lat/lng pair (Drizzle returns numerics as strings). */
function toLatLng(lat: string | null, lng: string | null): LatLng | null {
  if (lat == null || lng == null) return null;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { lat: a, lng: b };
}

const LIVE = ["draft", "proposed", "accepted", "confirmed"] as const;

export function chefOpenShiftsEnabled(): boolean {
  return env.CHEF_OPEN_SHIFTS_ENABLED === "true";
}

async function liveCounts(shiftIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (shiftIds.length === 0) return map;
  const rows = await db
    .select({ shiftId: placements.shiftId, n: sql<number>`count(*)::int` })
    .from(placements)
    .where(and(inArray(placements.shiftId, shiftIds), inArray(placements.status, [...LIVE])))
    .groupBy(placements.shiftId);
  for (const r of rows) map.set(r.shiftId, Number(r.n));
  return map;
}

export type OpenShift = {
  shiftId: string;
  clientName: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
  city: string | null;
  rateCents: number | null;
  interested: boolean;
  /* ----- CHEF-PR1: chef-facing match signals (best-effort; null = unknown) -- */
  /** 0-100 fit for THIS chef (matching.ts scorer). null if chef profile thin. */
  fitScore: number | null;
  /** Klant-safe positive reasons — "Waarom krijg ik deze shift?". */
  reasons: string[];
  /** One-way road-distance estimate in km (chef ↔ shift). null if no geo. */
  distanceKm: number | null;
  /** Hours until the shift starts — drives the urgency label. */
  hoursUntilStart: number;
  /** Gross indicatie in cents for the whole shift (hours × chef rate). */
  grossCents: number | null;
  /** Shift length in hours (rounded to 0.5) — pairs with the gross for clarity. */
  durationHours: number;
  /** Perks from the shift (real flags; null = unknown). */
  mealIncluded: boolean | null;
  parkingAvailable: boolean | null;
  startFlexible: boolean | null;
};

/**
 * Open shifts a chef can raise their hand on: future, not cancelled/completed,
 * with open headcount, the chef not already placed, and not on a date the chef
 * blocked in their availability.
 *
 * CHEF-PR1: each card now carries chef-facing signals — fit% + klant-safe
 * reasons (matching.ts scorer), a road-distance estimate (travel.ts), urgency
 * (hours-until-start), and a gross money indicatie. All best-effort: a thin
 * chef profile or missing geo simply yields null fields, never an error.
 */
export async function listOpenShiftsForChef(chefId: string, daysAhead = 28): Promise<OpenShift[]> {
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, chefId) });
  if (!chef) return [];
  const chefLatLng = toLatLng(chef.latitude, chef.longitude);
  const chefMode = (chef.transportMode ?? null) as TransportMode | null;

  const now = new Date();
  const horizon = new Date(now.getTime() + daysAhead * 24 * 3600 * 1000);
  const rows = await db
    .select({
      id: shifts.id,
      clientName: clients.companyName,
      role: shifts.roleNeeded,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      city: shifts.city,
      rateCents: shifts.chefRateCents,
      headcount: shifts.headcount,
      // CHEF-PR1: scoring + reasons inputs
      segment: shifts.segment,
      minExperience: shifts.minExperience,
      languageRequired: shifts.languageRequired,
      latitude: shifts.latitude,
      longitude: shifts.longitude,
      clientType: clients.clientType,
      clientTags: clients.clientTags,
      // CHEF-PR1: rate-clarity perks (real shift flags)
      mealIncluded: shifts.mealIncluded,
      parkingAvailable: shifts.parkingAvailable,
      startFlexible: shifts.startFlexible,
    })
    .from(shifts)
    .innerJoin(clients, eq(clients.id, shifts.clientId))
    .where(
      and(
        gt(shifts.startsAt, now),
        lt(shifts.startsAt, horizon),
        sql`${shifts.status} not in ('cancelled','completed')`,
      ),
    )
    .orderBy(asc(shifts.startsAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const live = await liveCounts(ids);

  const placed = await db
    .select({ shiftId: placements.shiftId })
    .from(placements)
    .where(and(eq(placements.chefId, chefId), inArray(placements.shiftId, ids)));
  const placedSet = new Set(placed.map((p) => p.shiftId));

  const blocked = await db
    .select({ date: chefAvailability.date })
    .from(chefAvailability)
    .where(and(eq(chefAvailability.chefId, chefId), eq(chefAvailability.available, false)));
  const blockedSet = new Set(blocked.map((b) => amsterdamDayKey(b.date)));

  const interests = await db
    .select({ shiftId: shiftInterests.shiftId })
    .from(shiftInterests)
    .where(
      and(
        eq(shiftInterests.chefId, chefId),
        inArray(shiftInterests.shiftId, ids),
        isNull(shiftInterests.withdrawnAt),
      ),
    );
  const interestSet = new Set(interests.map((i) => i.shiftId));

  const out: OpenShift[] = [];
  for (const r of rows) {
    if (placedSet.has(r.id)) continue;
    if (r.headcount - (live.get(r.id) ?? 0) <= 0) continue;
    if (blockedSet.has(amsterdamDayKey(r.startsAt))) continue;

    // Fit + klant-safe reasons (same scorer/weights the planner sees).
    const { score, reasons } = scoreChefForShift(chef, {
      roleNeeded: r.role,
      segment: r.segment,
      city: r.city,
      minExperience: r.minExperience,
      languageRequired: r.languageRequired,
      clientType: r.clientType,
      clientTags: r.clientTags,
    });

    // Road-distance estimate (best-effort — needs both endpoints geocoded).
    const shiftLatLng = toLatLng(r.latitude, r.longitude);
    const distanceKm =
      chefLatLng && shiftLatLng
        ? estimateTravel({ from: chefLatLng, to: shiftLatLng, mode: chefMode }).km
        : null;

    // Gross money indicatie for the whole shift (hours × chef rate).
    const hours = (r.endsAt.getTime() - r.startsAt.getTime()) / 3_600_000;
    const grossCents =
      r.rateCents != null && hours > 0 ? Math.round(r.rateCents * hours) : null;

    out.push({
      shiftId: r.id,
      clientName: r.clientName,
      role: r.role,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      city: r.city,
      rateCents: r.rateCents,
      interested: interestSet.has(r.id),
      fitScore: score > 0 ? score : null,
      reasons,
      distanceKm,
      hoursUntilStart: (r.startsAt.getTime() - now.getTime()) / 3_600_000,
      grossCents,
      durationHours: Math.round(hours * 2) / 2,
      mealIncluded: r.mealIncluded,
      parkingAvailable: r.parkingAvailable,
      startFlexible: r.startFlexible,
    });
  }
  return out;
}

export async function expressInterest(args: { chefId: string; shiftId: string }): Promise<void> {
  await db
    .insert(shiftInterests)
    .values({ chefId: args.chefId, shiftId: args.shiftId })
    .onConflictDoUpdate({
      target: [shiftInterests.shiftId, shiftInterests.chefId],
      set: { withdrawnAt: null },
    });
  await notifyOwnerOfInterest(args.chefId, args.shiftId).catch(() => {});
}

export async function withdrawInterest(args: { chefId: string; shiftId: string }): Promise<void> {
  await db
    .update(shiftInterests)
    .set({ withdrawnAt: new Date() })
    .where(and(eq(shiftInterests.chefId, args.chefId), eq(shiftInterests.shiftId, args.shiftId)));
}

export type InterestedChef = { chefId: string; name: string; since: Date };

/** Active interests for a shift (planner view) — who raised their hand. */
export async function listInterestedChefs(shiftId: string): Promise<InterestedChef[]> {
  const rows = await db
    .select({ chefId: shiftInterests.chefId, name: chefs.fullName, since: shiftInterests.createdAt })
    .from(shiftInterests)
    .innerJoin(chefs, eq(chefs.id, shiftInterests.chefId))
    .where(and(eq(shiftInterests.shiftId, shiftId), isNull(shiftInterests.withdrawnAt)))
    .orderBy(asc(shiftInterests.createdAt));
  return rows.map((r) => ({ chefId: r.chefId, name: r.name, since: r.since }));
}

async function notifyOwnerOfInterest(chefId: string, shiftId: string): Promise<void> {
  if (!env.MAARTEN_EMAIL) return;
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, env.MAARTEN_EMAIL))
    .limit(1);
  if (!owner) return;
  const [chef] = await db.select({ name: chefs.fullName }).from(chefs).where(eq(chefs.id, chefId)).limit(1);
  const [shift] = await db
    .select({ role: shifts.roleNeeded, startsAt: shifts.startsAt, clientName: clients.companyName })
    .from(shifts)
    .innerJoin(clients, eq(clients.id, shifts.clientId))
    .where(eq(shifts.id, shiftId))
    .limit(1);
  if (!chef || !shift) return;
  await createNotification({
    userId: owner.id,
    type: "shift_interest",
    title: `${chef.name} heeft interesse in een dienst`,
    body: `${shift.role} bij ${shift.clientName} — ${amsterdamDayKey(shift.startsAt)}`,
    actionUrl: `/admin/business/shifts/${shiftId}`,
    entityType: "shifts",
    entityId: shiftId,
  });
}
