/**
 * Chef↔klant relationship history — the track record of ONE chef at ONE client, for the
 * placement decision ("zal ik chef X wéér naar klant Y sturen / hoe ging het eerder?"):
 * how often worked, which roles, last time, no-shows/cancellations, and the internal rating
 * (avg + tags + comments). Owner-only (ratings are internal V1 — admin sees all). Read-only.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, placements, ratings, shifts } from "@/lib/db/schema";
import { formatChefRole } from "@/lib/labels";

const dayNl = (d: Date | string) => new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });

export async function chefHistoryAtClientForAi(chefId: string, clientId: string) {
  const [[chef], [client]] = await Promise.all([
    db.select({ name: chefs.fullName }).from(chefs).where(eq(chefs.id, chefId)).limit(1),
    db.select({ name: clients.companyName }).from(clients).where(eq(clients.id, clientId)).limit(1),
  ]);
  if (!chef || !client) return null;

  const [placementRows, ratingRows] = await Promise.all([
    db
      .select({ status: placements.status, role: shifts.roleNeeded, at: shifts.startsAt })
      .from(placements)
      .innerJoin(shifts, eq(shifts.id, placements.shiftId))
      .where(and(eq(placements.chefId, chefId), eq(shifts.clientId, clientId)))
      .orderBy(desc(shifts.startsAt)),
    db
      .select({ stars: ratings.stars, tags: ratings.tags, comment: ratings.comment })
      .from(ratings)
      .where(and(eq(ratings.chefId, chefId), eq(ratings.clientId, clientId)))
      .orderBy(desc(ratings.createdAt)),
  ]);

  const worked = placementRows.filter((p) => p.status === "completed" || p.status === "confirmed").length;
  const noShows = placementRows.filter((p) => p.status === "no_show").length;
  const cancelled = placementRows.filter((p) => p.status === "cancelled").length;
  const roles = [...new Set(placementRows.map((p) => formatChefRole(p.role ?? null)))];
  const last = placementRows.find((p) => p.status === "completed" || p.status === "confirmed")?.at ?? placementRows[0]?.at ?? null;
  const avg = ratingRows.length ? Math.round((ratingRows.reduce((s, r) => s + r.stars, 0) / ratingRows.length) * 10) / 10 : null;
  const tags = [...new Set(ratingRows.flatMap((r) => r.tags))].slice(0, 8);
  const comments = ratingRows.filter((r) => r.comment?.trim()).slice(0, 3).map((r) => r.comment!.trim());

  return {
    chef: chef.name,
    klant: client.name,
    keerGewerkt: worked,
    noShows,
    geannuleerd: cancelled,
    rollen: roles,
    laatst: last ? dayNl(last) : null,
    gemiddeldeBeoordeling:
      avg != null ? `${avg}★ (${ratingRows.length} beoordeling${ratingRows.length === 1 ? "" : "en"})` : "nog geen beoordeling",
    tags,
    opmerkingen: comments,
  };
}
