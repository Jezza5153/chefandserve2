/**
 * Smoke — chef PR-6 reliability-aware matching. Read-only + non-mutating.
 *
 * 1. The chef_events source columns the batch loader reads exist.
 * 2. The reliabilityAdjust logic (mirror matching.ts) is SOFT and correct:
 *    - no signal / few proposals → score unchanged
 *    - 3+ cancellations → ×0.8 penalty
 *    - low acceptance (≥4 proposals, <30%) → ×0.92
 *    - high acceptance (≥4 proposals, ≥75%) → ×1.05, clamped to 100
 *    - it NEVER hard-excludes (factor always > 0).
 *
 * Run (dev only): node --env-file=.env.local scripts/smoke-chef-pr6-reliability.mjs
 * Plain JS so it runs under node directly (tsx is unreliable on Node 25 here).
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";
if (!url) throw new Error("No DATABASE_URL — run via: node --env-file=.env.local scripts/...");
if (!/ep-green-mouse/.test(url)) {
  throw new Error(`Refusing: smoke runs against DEV (ep-green-mouse) only. Host looks like: ${(url.match(/@([^/]+)/) || [])[1]}`);
}
const sql = neon(url);
let failures = 0;
const ok = (label, pass) => {
  console.log(`${pass ? "✓" : "✗"} ${label}`);
  if (!pass) failures++;
};

// 1 — source columns present
const cols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='chef_events' AND column_name IN ('chef_id','event_type')`;
ok(`chef_events source columns present (${cols.length}/2)`, cols.length === 2);

// 2 — reliabilityAdjust (mirror matching.ts; flag assumed ON for the math test).
function adjust(base, rel) {
  if (!rel) return base;
  let factor = 1;
  if (rel.cancellations >= 3) factor *= 0.8;
  else if (rel.cancellations === 2) factor *= 0.9;
  if (rel.proposals >= 4 && rel.acceptanceRate != null) {
    if (rel.acceptanceRate < 0.3) factor *= 0.92;
    else if (rel.acceptanceRate >= 0.75) factor *= 1.05;
  }
  return Math.min(100, Math.round(base * factor));
}

ok("no signal → unchanged", adjust(80, undefined) === 80);
ok("clean (0 cancel, 0 prop) → unchanged", adjust(80, { cancellations: 0, proposals: 0, acceptanceRate: null }) === 80);
ok("3 cancellations → ×0.8 (80→64)", adjust(80, { cancellations: 3, proposals: 0, acceptanceRate: null }) === 64);
ok("2 cancellations → ×0.9 (80→72)", adjust(80, { cancellations: 2, proposals: 0, acceptanceRate: null }) === 72);
ok("low acceptance (5 prop, 20%) → ×0.92 (80→74)", adjust(80, { cancellations: 0, proposals: 5, acceptanceRate: 0.2 }) === 74);
ok("high acceptance (8 prop, 90%) → ×1.05 (80→84)", adjust(80, { cancellations: 0, proposals: 8, acceptanceRate: 0.9 }) === 84);
ok("high acceptance clamps at 100 (98→100)", adjust(98, { cancellations: 0, proposals: 8, acceptanceRate: 0.9 }) === 100);
ok("acceptance ignored under 4 proposals", adjust(80, { cancellations: 0, proposals: 3, acceptanceRate: 0.1 }) === 80);
ok("never hard-excludes (worst case > 0)", adjust(80, { cancellations: 9, proposals: 9, acceptanceRate: 0.0 }) > 0);

console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
