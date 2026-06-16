/**
 * P3b — favorite/blocked ordering in matching. The pure applyFavoriteBlockedOrder is
 * what findMatchesForShift uses when MATCHING_FAVORITES_ENABLED: klant favorites rank
 * up, klant-blocked sink to the bottom (visible, NOT excluded), score breaks ties
 * within a tier. Imports matching.ts (which pulls db) → run as .ts with an env file:
 *   npx tsx --env-file=.env.local scripts/smoke-matching-favorites.ts
 * (No DB query runs — only the pure helper is exercised.)
 */
import { applyFavoriteBlockedOrder } from "@/lib/domain/matching";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

console.log("=== Matching favorite/blocked ordering (pure) ===\n");

type R = { chef: { id: string }; score: number };
const rows: R[] = [
  { chef: { id: "normal-hi" }, score: 90 },
  { chef: { id: "fav-lo" }, score: 40 },
  { chef: { id: "blocked-hi" }, score: 95 },
  { chef: { id: "normal-lo" }, score: 50 },
  { chef: { id: "fav-hi" }, score: 70 },
];
const fav = new Set(["fav-lo", "fav-hi"]);
const blk = new Set(["blocked-hi"]);

const out = applyFavoriteBlockedOrder(rows, fav, blk);
const ids = out.map((r) => r.chef.id);

assert("favorites first, sorted by score within tier", ids[0] === "fav-hi" && ids[1] === "fav-lo", ids.join(","));
assert("normals next, by score", ids[2] === "normal-hi" && ids[3] === "normal-lo", ids.join(","));
assert("blocked LAST despite highest score (sink, not exclude)", ids[4] === "blocked-hi", ids.join(","));
assert("blocked still PRESENT (visible, not removed)", out.length === rows.length);
assert("pure: input array not mutated", rows[0].chef.id === "normal-hi");

// No favorites/blocked → plain score order.
const plain = applyFavoriteBlockedOrder(rows, new Set(), new Set()).map((r) => r.chef.id);
assert("empty sets → pure score-desc order", plain[0] === "blocked-hi" && plain[1] === "normal-hi", plain.join(","));

// A chef both favorite AND blocked → favorite tier wins (boost beats sink).
const conflict = applyFavoriteBlockedOrder(
  [{ chef: { id: "x" }, score: 10 }, { chef: { id: "y" }, score: 80 }],
  new Set(["x"]),
  new Set(["x"]),
).map((r) => r.chef.id);
assert("favorite∩blocked → favorite tier wins", conflict[0] === "x", conflict.join(","));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
