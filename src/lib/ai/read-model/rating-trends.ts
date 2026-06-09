/**
 * Rating-trends read-model — the fleet-wide quality sweep the single-chef chefs.feedback can't
 * give: which chefs are DECLINING (recent avg vs prior avg), and which chef↔klant pairs have
 * REPEATED low ratings ("Marco kreeg 2× ≤3★ bij Okura — let op bij de volgende match").
 *
 * Internal-only (ratings are internal V1; the owner assistant is admin-side). Names + numbers
 * only. Window: 90 days; "recent" = last 30; "prior" = the 60 before that.
 */
import { eq, gt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, ratings } from "@/lib/db/schema";

const WINDOW_DAYS = 90;
const RECENT_DAYS = 30;
const MIN_RATINGS_FOR_TREND = 3;
const LOW_STARS = 3; // ≤3★ counts as low for the repeat-pair signal

export type ChefRatingTrend = {
  chefId: string;
  chef: string;
  count90d: number;
  avg90d: number;
  avgRecent: number | null; // last 30d (null = no recent ratings)
  avgPrior: number | null; // the 60d before that
  direction: "dalend" | "stijgend" | "stabiel" | "te weinig data";
};

export type RepeatLowPair = {
  chefId: string;
  chef: string;
  clientId: string;
  client: string;
  lowCount: number;
  avgStars: number;
};

export type RatingTrends = {
  windowDays: number;
  totalRatings: number;
  declining: ChefRatingTrend[];
  repeatLowPairs: RepeatLowPair[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function sweepRatingTrends(now: Date): Promise<RatingTrends> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recentCutoff = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      chefId: ratings.chefId,
      chef: chefs.fullName,
      clientId: ratings.clientId,
      client: clients.companyName,
      stars: ratings.stars,
      createdAt: ratings.createdAt,
    })
    .from(ratings)
    .leftJoin(chefs, eq(ratings.chefId, chefs.id))
    .leftJoin(clients, eq(ratings.clientId, clients.id))
    .where(gt(ratings.createdAt, since));

  // Per-chef trend: recent (30d) avg vs prior (31-90d) avg.
  const byChef = new Map<string, { chef: string; recent: number[]; prior: number[] }>();
  for (const r of rows) {
    if (!r.chefId) continue;
    let b = byChef.get(r.chefId);
    if (!b) byChef.set(r.chefId, (b = { chef: r.chef ?? "onbekende chef", recent: [], prior: [] }));
    (r.createdAt > recentCutoff ? b.recent : b.prior).push(r.stars);
  }
  const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const trends: ChefRatingTrend[] = [...byChef.entries()].map(([chefId, b]) => {
    const all = [...b.recent, ...b.prior];
    const avgRecent = avg(b.recent);
    const avgPrior = avg(b.prior);
    const direction =
      all.length < MIN_RATINGS_FOR_TREND || avgRecent == null || avgPrior == null
        ? ("te weinig data" as const)
        : avgRecent <= avgPrior - 0.5
          ? ("dalend" as const)
          : avgRecent >= avgPrior + 0.5
            ? ("stijgend" as const)
            : ("stabiel" as const);
    return {
      chefId,
      chef: b.chef,
      count90d: all.length,
      avg90d: round1(avg(all) ?? 0),
      avgRecent: avgRecent == null ? null : round1(avgRecent),
      avgPrior: avgPrior == null ? null : round1(avgPrior),
      direction,
    };
  });
  const declining = trends
    .filter((t) => t.direction === "dalend")
    .sort((a, b) => (a.avgRecent ?? 5) - (b.avgRecent ?? 5));

  // Repeat-low pairs: same chef + same klant, ≥2 low ratings in the window.
  const byPair = new Map<string, RepeatLowPair & { stars: number[] }>();
  for (const r of rows) {
    if (!r.chefId || !r.clientId || r.stars > LOW_STARS) continue;
    const key = `${r.chefId}|${r.clientId}`;
    let p = byPair.get(key);
    if (!p) {
      byPair.set(
        key,
        (p = {
          chefId: r.chefId,
          chef: r.chef ?? "onbekende chef",
          clientId: r.clientId,
          client: r.client ?? "onbekende klant",
          lowCount: 0,
          avgStars: 0,
          stars: [],
        }),
      );
    }
    p.stars.push(r.stars);
    p.lowCount = p.stars.length;
  }
  const repeatLowPairs = [...byPair.values()]
    .filter((p) => p.lowCount >= 2)
    .map(({ stars, ...p }) => ({ ...p, avgStars: round1(stars.reduce((s, x) => s + x, 0) / stars.length) }))
    .sort((a, b) => b.lowCount - a.lowCount || a.avgStars - b.avgStars);

  return { windowDays: WINDOW_DAYS, totalRatings: rows.length, declining, repeatLowPairs };
}
