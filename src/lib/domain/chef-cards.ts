/**
 * ChefCard data — everything Maarten should know the instant a chef's name appears.
 *
 * The intimacy contract (his words: "even if we get big, a chef never feels like a
 * number"): face, tenure, lifetime hours, rating, last worked, what they're best used
 * for, and whether their birthday is coming. All of that already existed — scattered
 * over Chef360, the AI read-model and the metrics snapshots. This is the ONE loader
 * that assembles it, batched, so any surface rendering N chef names pays 3 queries,
 * not 3×N.
 *
 * INTERNAL-ONLY: rating, intel and birthday are owner/office knowledge. Never feed
 * this to a chef- or klant-facing surface (ratings V1 rule + AVG data-minimisation).
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefDocuments, chefMetricsDaily, chefs } from "@/lib/db/schema";
import { legacyHistory } from "@/lib/legacy-notes";
import { CHEF_AVERAGE_MIN_COUNT } from "@/lib/rating-tags";

export type ChefCardData = {
  id: string;
  fullName: string;
  vakniveau: string | null;
  city: string | null;
  phone: string | null;
  /** URL for /api/chef-photo/[docId], or null when no photo doc exists. */
  photoUrl: string | null;
  /** FINAL hours only (chef_metrics_daily). */
  totalHours: number;
  totalShifts: number;
  /** Shown only at >= CHEF_AVERAGE_MIN_COUNT ratings — a single 5.0 is noise, not a signal. */
  rating: { average: string; count: number } | null;
  /** Days since the last day with approved hours; null = never worked (yet). */
  lastWorkedDaysAgo: number | null;
  /** Whole years with us; 0 for the first year. */
  tenureYears: number;
  /** Maarten's own judgment line (intel.bestUsedFor) — internal only. */
  bestUsedFor: string | null;
  /** Days until the next birthday when within 30; null otherwise or unknown DOB. */
  birthdayInDays: number | null;
  /** Hours worked in the OLD system (parsed from the injected notes) — a migrated
   *  veteran must never render as "nieuw in het bestand". Null when no history. */
  legacyHours: number | null;
};

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Days from today (UTC calendar) to the next occurrence of month/day.
 *  Feb-29 celebrates on Feb-28 in common years — same rule as workers/reminders.ts. */
function daysUntilNext(month: number, day: number, from = new Date()): number {
  const ty = from.getUTCFullYear();
  const base = Date.UTC(ty, from.getUTCMonth(), from.getUTCDate());
  for (let y = ty; y <= ty + 1; y++) {
    const d = month === 2 && day === 29 && !isLeapYear(y) ? 28 : day;
    const diff = Math.round((Date.UTC(y, month - 1, d) - base) / 864e5);
    if (diff >= 0) return diff;
  }
  return 999;
}

/** Batched: 3 queries total regardless of how many ids. Unknown ids are simply absent. */
export async function getChefCards(chefIds: string[]): Promise<Map<string, ChefCardData>> {
  const ids = [...new Set(chefIds)].filter(Boolean);
  const out = new Map<string, ChefCardData>();
  if (ids.length === 0) return out;

  const [rows, photoRows, lifeRows] = await Promise.all([
    db
      .select({
        id: chefs.id,
        fullName: chefs.fullName,
        vakniveau: chefs.vakniveau,
        city: chefs.city,
        phone: chefs.phone,
        dateOfBirth: chefs.dateOfBirth,
        joinedAt: chefs.joinedAt,
        averageRating: chefs.averageRating,
        ratingCount: chefs.ratingCount,
        intel: chefs.intel,
        notes: chefs.notes,
      })
      .from(chefs)
      .where(and(inArray(chefs.id, ids), isNull(chefs.deletedAt))),
    // Newest photo doc per chef (any visibility — this is the internal card; the photo
    // ROUTE enforces who may actually fetch the bytes).
    db
      .select({ id: chefDocuments.id, chefId: chefDocuments.chefId, createdAt: chefDocuments.createdAt })
      .from(chefDocuments)
      .where(
        and(
          inArray(chefDocuments.chefId, ids),
          eq(chefDocuments.type, "photo"),
          isNull(chefDocuments.deletedAt),
        ),
      ),
    db
      .select({
        chefId: chefMetricsDaily.chefId,
        totalMinutes: sql<number>`coalesce(sum(${chefMetricsDaily.hoursWorkedMinutes}), 0)::int`,
        totalShifts: sql<number>`coalesce(sum(${chefMetricsDaily.completedShifts}), 0)::int`,
        lastWorked: sql<string | null>`max(${chefMetricsDaily.snapshotDate}) filter (where ${chefMetricsDaily.hoursWorkedMinutes} > 0)`,
      })
      .from(chefMetricsDaily)
      .where(inArray(chefMetricsDaily.chefId, ids))
      .groupBy(chefMetricsDaily.chefId),
  ]);

  const newestPhoto = new Map<string, { id: string; createdAt: Date }>();
  for (const ph of photoRows) {
    const cur = newestPhoto.get(ph.chefId);
    if (!cur || ph.createdAt > cur.createdAt) newestPhoto.set(ph.chefId, { id: ph.id, createdAt: ph.createdAt });
  }
  const life = new Map(lifeRows.map((r) => [r.chefId, r]));
  const now = new Date();

  for (const c of rows) {
    const l = life.get(c.id);
    let birthdayInDays: number | null = null;
    if (c.dateOfBirth) {
      const [, bm, bd] = c.dateOfBirth.split("-").map(Number);
      const n = daysUntilNext(bm!, bd!, now);
      birthdayInDays = n <= 30 ? n : null;
    }
    let lastWorkedDaysAgo: number | null = null;
    if (l?.lastWorked) {
      lastWorkedDaysAgo = Math.max(0, Math.round((now.getTime() - new Date(l.lastWorked).getTime()) / 864e5));
    }
    const tenureYears = Math.max(0, Math.floor((now.getTime() - new Date(c.joinedAt).getTime()) / (365.25 * 864e5)));

    out.set(c.id, {
      id: c.id,
      fullName: c.fullName,
      vakniveau: c.vakniveau,
      city: c.city,
      phone: c.phone,
      photoUrl: newestPhoto.has(c.id) ? `/api/chef-photo/${newestPhoto.get(c.id)!.id}` : null,
      totalHours: Math.round((l?.totalMinutes ?? 0) / 60),
      totalShifts: l?.totalShifts ?? 0,
      rating:
        c.averageRating != null && (c.ratingCount ?? 0) >= CHEF_AVERAGE_MIN_COUNT
          ? { average: c.averageRating, count: c.ratingCount ?? 0 }
          : null,
      lastWorkedDaysAgo,
      tenureYears,
      bestUsedFor: c.intel?.bestUsedFor?.trim() || null,
      birthdayInDays,
      legacyHours: legacyHistory(c.notes)?.hours ?? null,
    });
  }
  return out;
}
