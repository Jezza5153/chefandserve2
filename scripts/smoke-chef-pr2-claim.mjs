/**
 * Smoke — chef PR-2 emergency claim (CHEF). Read-only + non-mutating.
 *
 * 1. Migration 0058 columns present (chefs prefs + placements seen/expires + shifts is_emergency).
 * 2. The hardened headcount + shift-status guard boolean (the WHERE in claimEmergencyShift's
 *    atomic INSERT) evaluates correctly for the key cases — validated via CTEs so it never
 *    writes to real tables. Mirrors:
 *      (count of occupying placements) < (SELECT headcount FROM shifts
 *         WHERE id=? AND status NOT IN ('cancelled','completed','filled'))
 *
 * Run (dev only): node --env-file=.env.local scripts/smoke-chef-pr2-claim.mjs
 * Plain JS so it runs under node directly (tsx is unreliable on Node 25 here).
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";
if (!url) throw new Error("No DATABASE_URL — run via: npx dotenvx run -f .env.local -- node ...");
if (!/ep-green-mouse/.test(url)) {
  throw new Error(`Refusing: smoke runs against DEV (ep-green-mouse) only. Host looks like: ${(url.match(/@([^/]+)/) || [])[1]}`);
}
const sql = neon(url);
let failures = 0;
const ok = (label, pass) => {
  console.log(`${pass ? "✓" : "✗"} ${label}`);
  if (!pass) failures++;
};

// 1 — 0058 columns present
const cols = await sql`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE (table_name='chefs' AND column_name IN ('travel_radius_km','available_for_emergency','avoid_preferences','min_start_hour','availability_notes'))
     OR (table_name='shifts' AND column_name='is_emergency')
     OR (table_name='placements' AND column_name IN ('seen_at','expires_at'))`;
ok(`0058 columns present (${cols.length}/8)`, cols.length === 8);

// 2 — headcount + status guard boolean (CTE; no real-table writes)
async function canClaim(headcount, status, placed) {
  const r = await sql`
    WITH s AS (SELECT ${headcount}::int AS headcount, ${status}::text AS status),
         p AS (SELECT ${placed}::int AS cnt)
    SELECT ((SELECT cnt FROM p) <
            (SELECT headcount FROM s WHERE status NOT IN ('cancelled','completed','filled'))) AS can`;
  return r[0]?.can === true; // NULL/false both → not claimable
}
ok("open, headcount 1, 0 placed → claimable", (await canClaim(1, "open", 0)) === true);
ok("open, headcount 1, 1 placed → blocked (full)", (await canClaim(1, "open", 1)) === false);
ok("open, headcount 3, 2 placed → claimable", (await canClaim(3, "open", 2)) === true);
ok("cancelled shift → blocked (status guard)", (await canClaim(1, "cancelled", 0)) === false);
ok("filled shift → blocked (status guard)", (await canClaim(5, "filled", 0)) === false);
ok("headcount 0 → blocked", (await canClaim(0, "open", 0)) === false);

console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
