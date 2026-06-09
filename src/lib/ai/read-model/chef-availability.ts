/**
 * Per-chef availability read-model — "wanneer is chef X beschikbaar / is hij zaterdag vrij?".
 * The owner side of what the chef portal's mijn.beschikbaarheid shows: blocked days (available=
 * false, with reason) + explicitly-free days for the coming period. Read-only; owner-gated.
 */
import { and, asc, eq, gte, lte } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefAvailability, chefs } from "@/lib/db/schema";

const dayNl = (d: Date | string) => new Date(d).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });

export async function chefAvailabilityForAi(args: { chefId: string; days: number }) {
  const [chef] = await db.select({ name: chefs.fullName }).from(chefs).where(eq(chefs.id, args.chefId)).limit(1);
  if (!chef) return null;

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const until = new Date(from.getTime() + args.days * 86_400_000);

  const rows = await db
    .select({ date: chefAvailability.date, available: chefAvailability.available, notes: chefAvailability.notes })
    .from(chefAvailability)
    .where(and(eq(chefAvailability.chefId, args.chefId), gte(chefAvailability.date, from), lte(chefAvailability.date, until)))
    .orderBy(asc(chefAvailability.date));

  return {
    chef: chef.name,
    dagen: args.days,
    geblokkeerd: rows.filter((r) => !r.available).map((r) => ({ datum: dayNl(r.date), reden: r.notes ?? null })),
    expliciet_vrij: rows.filter((r) => r.available).map((r) => dayNl(r.date)),
    doorgegeven: rows.length,
  };
}
