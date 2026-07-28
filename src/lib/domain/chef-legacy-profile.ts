/**
 * The migrated history of ONE chef, as structured facts instead of a text blob.
 *
 * The problem this solves (spotted on the chef page): "Patronen & relaties" said
 * "nog geen werkpatroon — deze chef heeft nog geen afgeronde diensten" while two
 * centimetres above it the notes read "±106 uur gewerkt · beoordeling 7.7/10". The
 * migrated data sat ON the page as text instead of feeding the cards, so the system
 * kept contradicting itself.
 *
 * Everything here is computed from `chef_client_history` — the structured pair table —
 * never parsed out of prose. The rating is the old system's 1..10 scale, weighted by how
 * many ratings each klant gave, and is always labelled as such: it is NOT our 1..5 rating
 * and must never be averaged together with it.
 */
import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefClientHistory, clients } from "@/lib/db/schema";

export type LegacyChefProfile = {
  /** Hours worked in the old system, all klanten together. */
  urenGewerkt: number;
  uitnodigingen: number;
  /** Weighted 1..10 average, or null when no klant ever rated them. */
  beoordeling: number | null;
  beoordelingen: number;
  /** How many different klanten they worked for. */
  klanten: number;
  /** Where they worked most, biggest first. */
  topKlanten: { naam: string; clientId: string | null; uren: number; beoordeling: number | null }[];
};

export async function getLegacyChefProfile(chefId: string): Promise<LegacyChefProfile | null> {
  const rows = (await db
    .select({
      naam: clients.companyName,
      clientId: chefClientHistory.clientId,
      minutes: chefClientHistory.legacyMinutes,
      invites: chefClientHistory.legacyInvites,
      rating: chefClientHistory.legacyRating,
      ratingCount: chefClientHistory.legacyRatingCount,
      source: chefClientHistory.source,
    })
    .from(chefClientHistory)
    .leftJoin(clients, eq(clients.id, chefClientHistory.clientId))
    .where(eq(chefClientHistory.chefId, chefId))
    .orderBy(desc(chefClientHistory.legacyMinutes))) as {
    naam: string | null; clientId: string | null; minutes: number; invites: number;
    rating: string | null; ratingCount: number; source: string;
  }[];

  if (rows.length === 0) return null;

  // Multi-venue klanten carry one row per venue with the SAME company-level total
  // (source 'shiftmanager:debiteur'), so summing them raw would multiply the hours.
  // Count each company once: for those rows, keep the first venue only.
  const seenCompany = new Set<string>();
  const counted = rows.filter((r) => {
    if (r.source !== "shiftmanager:debiteur") return true;
    const company = (r.naam ?? "").split(" — ")[0];
    if (seenCompany.has(company)) return false;
    seenCompany.add(company);
    return true;
  });

  const minutes = counted.reduce((a, r) => a + r.minutes, 0);
  const invites = counted.reduce((a, r) => a + r.invites, 0);
  const ratedRows = counted.filter((r) => r.ratingCount > 0 && r.rating != null);
  const ratingWeightSum = ratedRows.reduce((a, r) => a + r.ratingCount, 0);
  const rating =
    ratingWeightSum > 0
      ? Math.round((ratedRows.reduce((a, r) => a + Number(r.rating) * r.ratingCount, 0) / ratingWeightSum) * 10) / 10
      : null;

  return {
    urenGewerkt: Math.round(minutes / 60),
    uitnodigingen: invites,
    beoordeling: rating,
    beoordelingen: ratingWeightSum,
    klanten: counted.length,
    topKlanten: counted.slice(0, 5).map((r) => ({
      naam: r.naam ?? "onbekende klant",
      clientId: r.clientId,
      uren: Math.round(r.minutes / 60),
      beoordeling: r.ratingCount > 0 && r.rating != null ? Number(r.rating) : null,
    })),
  };
}

/** Batch variant for list surfaces — one query for many chefs. */
export async function getLegacyHoursForChefs(chefIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (chefIds.length === 0) return out;
  const rows = (await db
    .select({
      chefId: chefClientHistory.chefId,
      minutes: sql<number>`sum(${chefClientHistory.legacyMinutes})::int`,
    })
    .from(chefClientHistory)
    .where(sql`${chefClientHistory.chefId} = any(${sql.raw(`array['${chefIds.map((i) => i.replace(/'/g, "")).join("','")}']::text[]`)})`)
    .groupBy(chefClientHistory.chefId)) as { chefId: string; minutes: number }[];
  for (const r of rows) out.set(r.chefId, Math.round(r.minutes / 60));
  return out;
}
