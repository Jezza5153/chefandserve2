/**
 * Ratings domain (PR-KLANT-5) — submit + visibility-scoped readers.
 *
 * Visibility rules are ENCODED here, not just documented:
 *   - getChefAverageForAdmin → full average + count + recent feedback (always)
 *   - getChefSummaryForChef  → averageRating NULL until ratingCount >= 5
 *   - getChefPreviewForKlant → NO rating data at all (internal-only V1)
 *
 * submitRating recomputes chefs.averageRating + ratingCount in the SAME tx as
 * the insert. One rating per placement (UNIQUE → double-submit guarded).
 */

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import { chefs, placements, ratings, shifts } from "@/lib/db/schema";
import { CHEF_AVERAGE_MIN_COUNT, sanitizeTags } from "@/lib/rating-tags";

export type SubmitRatingResult =
  | { ok: true; id: string }
  | { ok: false; error: "invalid" | "not_found" | "already_rated" | "db" };

export async function submitRating(args: {
  placementId: string;
  clientId: string;
  createdBy: string;
  stars: number;
  tags: string[];
  comment?: string | null;
}): Promise<SubmitRatingResult> {
  if (!Number.isInteger(args.stars) || args.stars < 1 || args.stars > 5) {
    return { ok: false, error: "invalid" };
  }
  const tags = sanitizeTags(args.tags);
  const comment = (args.comment ?? "").trim().slice(0, 2000) || null;

  // Ownership + chef resolution: placement → shift owned by this client.
  const [row] = await db
    .select({ chefId: placements.chefId })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .where(
      and(eq(placements.id, args.placementId), eq(shifts.clientId, args.clientId)),
    )
    .limit(1);
  if (!row) return { ok: false, error: "not_found" };

  // Insert first (UNIQUE placement_id guards double-submit). The neon-http
  // driver has no interactive transactions, so the rollup recompute is a
  // follow-up statement — it reads the just-committed row, and any one-off
  // staleness self-heals on the next rating (rollup is a non-critical cache;
  // ratings is the source of truth).
  let id: string;
  try {
    const [inserted] = await db
      .insert(ratings)
      .values({
        placementId: args.placementId,
        chefId: row.chefId,
        clientId: args.clientId,
        stars: args.stars,
        tags,
        comment,
        createdBy: args.createdBy,
      })
      .returning({ id: ratings.id });
    id = inserted.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("ratings_placement_id_unique") || msg.includes("23505")) {
      return { ok: false, error: "already_rated" };
    }
    console.error("[ratings] insert failed:", msg);
    return { ok: false, error: "db" };
  }

  // Recompute the chef rollup from the source of truth. CLIENT ratings only — internal
  // owner ratings (D2) are tracked separately and must not skew the public/self ★.
  await db
    .update(chefs)
    .set({
      averageRating: sql`(SELECT round(avg(stars)::numeric, 2) FROM ratings WHERE chef_id = ${row.chefId} AND source = 'client')`,
      ratingCount: sql`(SELECT count(*)::int FROM ratings WHERE chef_id = ${row.chefId} AND source = 'client')`,
      updatedAt: new Date(),
    })
    .where(eq(chefs.id, row.chefId));

  await recordAuditFromRequest({
    userId: args.createdBy,
    action: "ratings.created",
    resource: "ratings",
    resourceId: id,
    after: { placementId: args.placementId, chefId: row.chefId, stars: args.stars, tags },
  });

  return { ok: true, id };
}

export type SubmitInternalRatingResult = { ok: true; id: string } | { ok: false; error: "invalid" | "db" };

/**
 * D2: Maarten's OWN internal assessment of a chef — not tied to a placement or klant.
 * source='internal', placementId/clientId NULL. Deliberately does NOT touch the client
 * rollup (chefs.averageRating stays klant-only); the internal aggregate is read on demand
 * by getChefAverageForAdmin. Owner-only; createdBy is the session user.
 */
export async function submitInternalRating(args: {
  chefId: string;
  createdBy: string;
  stars: number;
  tags?: string[];
  comment?: string | null;
}): Promise<SubmitInternalRatingResult> {
  if (!Number.isInteger(args.stars) || args.stars < 1 || args.stars > 5) {
    return { ok: false, error: "invalid" };
  }
  const tags = sanitizeTags(args.tags ?? []);
  const comment = (args.comment ?? "").trim().slice(0, 2000) || null;
  try {
    const [inserted] = await db
      .insert(ratings)
      .values({ chefId: args.chefId, stars: args.stars, source: "internal", tags, comment, createdBy: args.createdBy })
      .returning({ id: ratings.id });
    await recordAuditFromRequest({
      userId: args.createdBy,
      action: "ratings.internal_created",
      resource: "ratings",
      resourceId: inserted.id,
      after: { chefId: args.chefId, stars: args.stars, tags },
    });
    return { ok: true, id: inserted.id };
  } catch (err) {
    console.error("[ratings] internal insert failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "db" };
  }
}

/** Admin: full picture, always — klant ★ (the rollup) PLUS Maarten's own internal ★. */
export async function getChefAverageForAdmin(chefId: string): Promise<{
  averageRating: number | null;
  ratingCount: number;
  internalAverage: number | null;
  internalCount: number;
  recent: Array<{ stars: number; tags: string[]; comment: string | null; createdAt: Date; source: "client" | "internal" }>;
}> {
  const [c] = await db
    .select({ averageRating: chefs.averageRating, ratingCount: chefs.ratingCount })
    .from(chefs)
    .where(eq(chefs.id, chefId))
    .limit(1);
  const [internal] = await db
    .select({
      avg: sql<string | null>`round(avg(${ratings.stars})::numeric, 2)`,
      count: sql<number>`count(*)::int`,
    })
    .from(ratings)
    .where(and(eq(ratings.chefId, chefId), eq(ratings.source, "internal")));
  const recent = await db
    .select({
      stars: ratings.stars,
      tags: ratings.tags,
      comment: ratings.comment,
      createdAt: ratings.createdAt,
      source: ratings.source,
    })
    .from(ratings)
    .where(eq(ratings.chefId, chefId))
    .orderBy(desc(ratings.createdAt))
    .limit(10);
  return {
    averageRating: c?.averageRating ? Number(c.averageRating) : null,
    ratingCount: c?.ratingCount ?? 0,
    internalAverage: internal?.avg ? Number(internal.avg) : null,
    internalCount: internal?.count ?? 0,
    recent: recent as Array<{ stars: number; tags: string[]; comment: string | null; createdAt: Date; source: "client" | "internal" }>,
  };
}

/** Chef: count always; average only at N>=5; never individual comments (V1). */
export async function getChefSummaryForChef(chefId: string): Promise<{
  ratingCount: number;
  hasFeedback: boolean;
  averageRating: number | null;
}> {
  const [c] = await db
    .select({ averageRating: chefs.averageRating, ratingCount: chefs.ratingCount })
    .from(chefs)
    .where(eq(chefs.id, chefId))
    .limit(1);
  const count = c?.ratingCount ?? 0;
  return {
    ratingCount: count,
    hasFeedback: count > 0,
    averageRating:
      count >= CHEF_AVERAGE_MIN_COUNT && c?.averageRating
        ? Number(c.averageRating)
        : null,
  };
}

/** Klant preview of a chef: NO rating data in V1. */
export function getChefPreviewForKlant(): { ratingVisible: false } {
  return { ratingVisible: false };
}
