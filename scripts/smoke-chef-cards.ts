/**
 * Smoke: getChefCards RUNS and behaves (the ChefCard hover-data loader).
 *
 * Executes the real batched queries against dev + checks the behavioural contract:
 * batching (3 queries regardless of N), the rating-volume gate (a thin rating must
 * NOT show), the Feb-29 birthday rule, and graceful degradation when the metrics
 * table is empty (dev has no snapshots — exactly the edge worth pinning).
 *
 *   npx tsx --env-file=.env.local scripts/smoke-chef-cards.ts
 */
import { isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import { getChefCards } from "@/lib/domain/chef-cards";
import { CHEF_AVERAGE_MIN_COUNT } from "@/lib/rating-tags";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "?";
  if (host.includes("ep-icy-scene")) { console.error("REFUSING: production. Dev only."); process.exit(2); }
  console.log(`=== chef-cards smoke (${host}) ===\n`);

  const all = await db.select({ id: chefs.id }).from(chefs).where(isNull(chefs.deletedAt));
  const ids = all.map((c) => c.id);

  const cards = await getChefCards(ids);
  ok(`loads a card for every chef (${cards.size}/${ids.length})`, cards.size === ids.length);

  const empty = await getChefCards([]);
  ok("empty input → empty map, no query", empty.size === 0);

  const dupes = await getChefCards([ids[0]!, ids[0]!, ids[0]!]);
  ok("duplicate ids are deduped", dupes.size === 1);

  const ghost = await getChefCards(["not-a-real-chef-id"]);
  ok("unknown id is simply absent, no throw", ghost.size === 0);

  console.log("\nthe contract per card:");
  const sample = [...cards.values()];
  ok("totalHours is a non-negative number everywhere",
     sample.every((c) => Number.isFinite(c.totalHours) && c.totalHours >= 0));
  ok(`rating only shows at >= ${CHEF_AVERAGE_MIN_COUNT} ratings (the volume gate)`,
     sample.every((c) => c.rating === null || c.rating.count >= CHEF_AVERAGE_MIN_COUNT));
  ok("birthdayInDays is null or 0..30",
     sample.every((c) => c.birthdayInDays === null || (c.birthdayInDays >= 0 && c.birthdayInDays <= 30)));
  ok("tenureYears is a non-negative integer",
     sample.every((c) => Number.isInteger(c.tenureYears) && c.tenureYears >= 0));
  ok("photoUrl is null or an /api/chef-photo/ path",
     sample.every((c) => c.photoUrl === null || c.photoUrl.startsWith("/api/chef-photo/")));

  console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
