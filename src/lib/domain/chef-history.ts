/**
 * Chef 360 read model — Cockpit PR-1.6. The chef's real track record, built from
 * existing data (shift_hours · placements · shifts · clients · ratings). No AI,
 * no fabrication — every number is real or explicitly absent.
 *
 * HARDENING (proof-based, not decorative):
 *  - totalHoursWorked = Σ shift_hours.workedMinutes ONLY for FINAL statuses
 *    (admin_approved / exported). Never draft/submitted/rejected/void; never
 *    upcoming. (`shiftHoursStatusEnum` in schema.ts.)
 *  - reliability = raw counts, never a fabricated score.
 *  - feedback = real `ratings` rows only (stars/tags/comment); tag taxonomy is
 *    the shared RATING_TAGS (rating-tags.ts). Never AI-generated feedback.
 *
 * `getChefClientHistory` is the canonical "worked here before" signal — PR-3.1
 * ranking reuses it.
 */

import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, placements, ratings, shiftHours, shifts } from "@/lib/db/schema";

/** shift_hours statuses that count as actually-worked, paid-grade hours. */
const FINAL_HOURS_STATUSES = ["admin_approved", "exported"] as const;

export type WorkSummary = {
  totalHoursWorked: number; // whole hours, from FINAL shift_hours only
  completedShifts: number;
  upcomingShifts: number;
  proposedCount: number;
  acceptedCount: number;
  declinedCount: number; // rejected by chef
  cancelledCount: number;
  noShowCount: number;
  averageRating: number | null; // from real ratings; null if none
  ratingCount: number;
  lastWorkedAt: Date | null;
  topClients: { name: string; count: number }[];
  topSegments: { segment: string; count: number }[];
  topClientTypes: { clientType: string; count: number }[]; // PR-2B "wat voor klant"
};

export async function getChefWorkSummary(chefId: string): Promise<WorkSummary> {
  const [
    [hours],
    statusRows,
    [upcoming],
    [last],
    topClients,
    topSegments,
    topClientTypes,
    [rating],
  ] = await Promise.all([
    db
      .select({ minutes: sql<number>`coalesce(sum(${shiftHours.workedMinutes}), 0)::int` })
      .from(shiftHours)
      .where(and(eq(shiftHours.chefId, chefId), inArray(shiftHours.status, [...FINAL_HOURS_STATUSES]))),
    db
      .select({ status: placements.status, n: sql<number>`count(*)::int` })
      .from(placements)
      .where(eq(placements.chefId, chefId))
      .groupBy(placements.status),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(placements)
      .innerJoin(shifts, eq(shifts.id, placements.shiftId))
      .where(and(eq(placements.chefId, chefId), eq(placements.status, "confirmed"), gt(shifts.startsAt, new Date()))),
    db
      .select({ at: sql<Date | null>`max(${shifts.endsAt})` })
      .from(placements)
      .innerJoin(shifts, eq(shifts.id, placements.shiftId))
      .where(and(eq(placements.chefId, chefId), eq(placements.status, "completed"))),
    db
      .select({ name: clients.companyName, count: sql<number>`count(*)::int` })
      .from(placements)
      .innerJoin(shifts, eq(shifts.id, placements.shiftId))
      .innerJoin(clients, eq(clients.id, shifts.clientId))
      .where(and(eq(placements.chefId, chefId), inArray(placements.status, ["completed", "confirmed"])))
      .groupBy(clients.companyName)
      .orderBy(sql`count(*) desc`)
      .limit(5),
    db
      .select({ segment: shifts.segment, count: sql<number>`count(*)::int` })
      .from(placements)
      .innerJoin(shifts, eq(shifts.id, placements.shiftId))
      .where(and(eq(placements.chefId, chefId), inArray(placements.status, ["completed", "confirmed"])))
      .groupBy(shifts.segment)
      .orderBy(sql`count(*) desc`)
      .limit(5),
    db
      .select({ clientType: clients.clientType, count: sql<number>`count(*)::int` })
      .from(placements)
      .innerJoin(shifts, eq(shifts.id, placements.shiftId))
      .innerJoin(clients, eq(clients.id, shifts.clientId))
      .where(and(eq(placements.chefId, chefId), inArray(placements.status, ["completed", "confirmed"])))
      .groupBy(clients.clientType)
      .orderBy(sql`count(*) desc`)
      .limit(5),
    db
      .select({
        avg: sql<number | null>`round(avg(${ratings.stars})::numeric, 1)`,
        n: sql<number>`count(*)::int`,
      })
      .from(ratings)
      .where(eq(ratings.chefId, chefId)),
  ]);

  const byStatus = new Map(statusRows.map((r) => [r.status, r.n]));
  return {
    totalHoursWorked: Math.round((hours?.minutes ?? 0) / 60),
    completedShifts: byStatus.get("completed") ?? 0,
    upcomingShifts: upcoming?.n ?? 0,
    proposedCount: byStatus.get("proposed") ?? 0,
    acceptedCount: byStatus.get("accepted") ?? 0,
    declinedCount: byStatus.get("rejected") ?? 0,
    cancelledCount: byStatus.get("cancelled") ?? 0,
    noShowCount: byStatus.get("no_show") ?? 0,
    averageRating: rating?.avg != null ? Number(rating.avg) : null,
    ratingCount: rating?.n ?? 0,
    lastWorkedAt: last?.at ?? null,
    topClients: topClients.map((c) => ({ name: c.name, count: c.count })),
    topSegments: topSegments
      .filter((s) => s.segment != null)
      .map((s) => ({ segment: String(s.segment), count: s.count })),
    topClientTypes: topClientTypes
      .filter((t) => t.clientType != null)
      .map((t) => ({ clientType: String(t.clientType), count: t.count })),
  };
}

export type FeedbackItem = {
  stars: number;
  tags: string[];
  comment: string | null;
  clientName: string | null;
  createdAt: Date;
};

export type FeedbackSummary = {
  recent: FeedbackItem[];
  topTags: { tag: string; count: number }[];
};

/** Real client feedback only. topTags = frequency over RATING_TAGS keys. */
export async function getChefFeedbackSummary(chefId: string, limit = 8): Promise<FeedbackSummary> {
  const rows = await db
    .select({
      stars: ratings.stars,
      tags: ratings.tags,
      comment: ratings.comment,
      clientName: clients.companyName,
      createdAt: ratings.createdAt,
    })
    .from(ratings)
    .leftJoin(clients, eq(clients.id, ratings.clientId))
    .where(eq(ratings.chefId, chefId))
    .orderBy(desc(ratings.createdAt))
    .limit(limit);

  const tagCounts = new Map<string, number>();
  // Count tags across ALL of the chef's ratings (not just the recent page).
  const allTagRows = await db
    .select({ tags: ratings.tags })
    .from(ratings)
    .where(eq(ratings.chefId, chefId));
  for (const r of allTagRows) {
    for (const t of r.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const topTags = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    recent: rows.map((r) => ({
      stars: r.stars,
      tags: r.tags ?? [],
      comment: r.comment,
      clientName: r.clientName,
      createdAt: r.createdAt,
    })),
    topTags,
  };
}

export type RecentShift = {
  shiftId: string;
  startsAt: Date;
  endsAt: Date;
  roleNeeded: string;
  city: string | null;
  clientName: string | null;
  placementStatus: string;
};

export async function getChefRecentShifts(chefId: string, limit = 10): Promise<RecentShift[]> {
  const rows = await db
    .select({
      shiftId: shifts.id,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      roleNeeded: shifts.roleNeeded,
      city: shifts.city,
      clientName: clients.companyName,
      placementStatus: placements.status,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .leftJoin(clients, eq(clients.id, shifts.clientId))
    .where(eq(placements.chefId, chefId))
    .orderBy(desc(shifts.startsAt))
    .limit(limit);
  return rows;
}

export type ChefClientHistory = {
  completedShifts: number;
  lastWorkedAt: Date | null;
  averageRatingForClient: number | null;
  isFavorite: boolean; // PR-2B wires clients.favorite_chef_ids
  isBlocked: boolean; // PR-2B wires clients.blocked_chef_ids
};

/** Canonical "worked here before" signal (PR-3.1 ranking reuses this). */
export async function getChefClientHistory(
  chefId: string,
  clientId: string,
): Promise<ChefClientHistory> {
  const [[hist], [rating], [client]] = await Promise.all([
    db
      .select({
        completed: sql<number>`count(*) filter (where ${placements.status} = 'completed')::int`,
        lastWorkedAt: sql<Date | null>`max(${shifts.endsAt}) filter (where ${placements.status} = 'completed')`,
      })
      .from(placements)
      .innerJoin(shifts, eq(shifts.id, placements.shiftId))
      .where(and(eq(placements.chefId, chefId), eq(shifts.clientId, clientId))),
    db
      .select({ avg: sql<number | null>`round(avg(${ratings.stars})::numeric, 1)` })
      .from(ratings)
      .where(and(eq(ratings.chefId, chefId), eq(ratings.clientId, clientId))),
    db
      .select({ fav: clients.favoriteChefIds, blk: clients.blockedChefIds })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1),
  ]);

  return {
    completedShifts: hist?.completed ?? 0,
    lastWorkedAt: hist?.lastWorkedAt ?? null,
    averageRatingForClient: rating?.avg != null ? Number(rating.avg) : null,
    isFavorite: (client?.fav ?? []).includes(chefId), // PR-2B
    isBlocked: (client?.blk ?? []).includes(chefId), // PR-2B
  };
}
