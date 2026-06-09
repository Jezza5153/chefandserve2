/**
 * Watchdog read-model — the §6 decision-point detectors (AI_INTEGRATION.md), the "proposes work
 * unprompted" tier. Three deterministic detectors (no LLM calls — predictable, cost-free):
 *
 *   1. staleOpenShifts — future shifts still 'open' >24h after posting → suggest tariff bump /
 *      widening the selection.
 *   2. silentChefs — active chefs with no placement AND no contact-log touch in 30+ days →
 *      draft a check-in.
 *   3. lowRatings — ratings ≤2★ in the last 7 days → draft an apology / follow-up call.
 *
 * Names + counts only (no rates, no PII beyond names — the notification needs a human handle).
 * Consumed by /api/cron/ai-watchdog which turns findings into throttled owner notifications.
 */
import { and, desc, eq, gt, inArray, isNull, lt, max } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, contactLogs, placements, ratings, shifts } from "@/lib/db/schema";

const PER_DETECTOR_CAP = 10;

export type StaleOpenShift = {
  shiftId: string;
  client: string;
  role: string;
  startsAt: Date;
  openForHours: number;
  openSlots: number;
};

export type SilentChef = {
  chefId: string;
  chef: string;
  lastSeenDays: number | null; // null = never seen at all
};

export type LowRating = {
  ratingId: string;
  chefId: string | null;
  chef: string | null;
  client: string | null;
  stars: number;
  createdAt: Date;
};

export type WatchdogFindings = {
  staleOpenShifts: StaleOpenShift[];
  silentChefs: SilentChef[];
  lowRatings: LowRating[];
};

/** Future shifts still 'open' >24h after posting, soonest first. */
export async function findStaleOpenShifts(now: Date): Promise<StaleOpenShift[]> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: shifts.id,
      client: clients.companyName,
      role: shifts.roleNeeded,
      startsAt: shifts.startsAt,
      headcount: shifts.headcount,
      createdAt: shifts.createdAt,
    })
    .from(shifts)
    .leftJoin(clients, eq(shifts.clientId, clients.id))
    .where(and(eq(shifts.status, "open"), gt(shifts.startsAt, now), lt(shifts.createdAt, cutoff)))
    .orderBy(shifts.startsAt)
    .limit(PER_DETECTOR_CAP);
  if (rows.length === 0) return [];

  const confirmed = await db
    .select({ shiftId: placements.shiftId })
    .from(placements)
    .where(and(inArray(placements.shiftId, rows.map((r) => r.id)), eq(placements.status, "confirmed")));
  const filled = new Map<string, number>();
  for (const p of confirmed) filled.set(p.shiftId, (filled.get(p.shiftId) ?? 0) + 1);

  return rows
    .map((r) => ({
      shiftId: r.id,
      client: r.client ?? "onbekende klant",
      role: String(r.role).replace(/_/g, " "),
      startsAt: r.startsAt,
      openForHours: Math.round((now.getTime() - r.createdAt.getTime()) / 3_600_000),
      openSlots: Math.max(0, (r.headcount || 1) - (filled.get(r.id) ?? 0)),
    }))
    .filter((r) => r.openSlots > 0);
}

/** Active chefs with no placement and no contact-log touch in `silentDays` (default 30). */
export async function findSilentChefs(now: Date, silentDays = 30): Promise<SilentChef[]> {
  const cutoff = new Date(now.getTime() - silentDays * 24 * 60 * 60 * 1000);
  const activeChefs = await db
    .select({ id: chefs.id, name: chefs.fullName, createdAt: chefs.createdAt })
    .from(chefs)
    .where(and(isNull(chefs.deletedAt), eq(chefs.status, "active")));
  if (activeChefs.length === 0) return [];
  const ids = activeChefs.map((c) => c.id);

  const [lastPlacement, lastContact] = await Promise.all([
    db
      .select({ chefId: placements.chefId, last: max(placements.createdAt) })
      .from(placements)
      .where(inArray(placements.chefId, ids))
      .groupBy(placements.chefId),
    db
      .select({ targetId: contactLogs.targetId, last: max(contactLogs.createdAt) })
      .from(contactLogs)
      .where(and(eq(contactLogs.targetType, "chef"), inArray(contactLogs.targetId, ids)))
      .groupBy(contactLogs.targetId),
  ]);
  const lastSeen = new Map<string, Date>();
  const bump = (id: string, d: Date | null) => {
    if (!d) return;
    const cur = lastSeen.get(id);
    if (!cur || d > cur) lastSeen.set(id, d);
  };
  for (const p of lastPlacement) bump(p.chefId, p.last);
  for (const c of lastContact) bump(c.targetId, c.last);

  return activeChefs
    .filter((c) => c.createdAt < cutoff) // a chef newer than the window isn't "silent"
    .map((c) => {
      const seen = lastSeen.get(c.id) ?? null;
      return {
        chefId: c.id,
        chef: c.name,
        lastSeenDays: seen ? Math.floor((now.getTime() - seen.getTime()) / 86_400_000) : null,
        _silent: !seen || seen < cutoff,
      };
    })
    .filter((c) => c._silent)
    .map(({ chefId, chef, lastSeenDays }) => ({ chefId, chef, lastSeenDays }))
    .sort((a, b) => (b.lastSeenDays ?? 9999) - (a.lastSeenDays ?? 9999))
    .slice(0, PER_DETECTOR_CAP);
}

/** Ratings ≤2★ from the last `days` (default 7), newest first. */
export async function findLowRatings(now: Date, days = 7): Promise<LowRating[]> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: ratings.id,
      chefId: ratings.chefId,
      chef: chefs.fullName,
      client: clients.companyName,
      stars: ratings.stars,
      createdAt: ratings.createdAt,
    })
    .from(ratings)
    .leftJoin(chefs, eq(ratings.chefId, chefs.id))
    .leftJoin(clients, eq(ratings.clientId, clients.id))
    .where(and(gt(ratings.createdAt, since), lt(ratings.stars, 3)))
    .orderBy(desc(ratings.createdAt))
    .limit(PER_DETECTOR_CAP);
  return rows.map((r) => ({
    ratingId: r.id,
    chefId: r.chefId,
    chef: r.chef,
    client: r.client,
    stars: r.stars,
    createdAt: r.createdAt,
  }));
}

export async function runWatchdog(now: Date): Promise<WatchdogFindings> {
  const [staleOpenShifts, silentChefs, lowRatings] = await Promise.all([
    findStaleOpenShifts(now),
    findSilentChefs(now),
    findLowRatings(now),
  ]);
  return { staleOpenShifts, silentChefs, lowRatings };
}
