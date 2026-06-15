/**
 * Smoke — chef PR-4 clock-out review (CHEF). Read-only + non-mutating.
 *
 * 1. Migration 0061 table + columns present (shift_hour_reviews).
 * 2. The one-review-per-placement guarantee is enforced at the DB level
 *    (unique index on placement_id) — so the domain's onConflictDoNothing
 *    can't be bypassed by a double-submit race.
 * 3. The owner-attention "flagged" predicate (mirrors submitClockOutReview)
 *    fires on a client issue and stays quiet on a clean shift — validated as
 *    pure boolean logic (no real-table writes).
 *
 * Run (dev only): node --env-file=.env.local scripts/smoke-chef-pr4-clockout-review.mjs
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

// 1 — 0061 table + columns present
const cols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='shift_hour_reviews'
    AND column_name IN ('id','placement_id','chef_id','worked_planned_role',
      'worked_extra_hours','got_break','as_described','issue_note','would_return','created_at')`;
ok(`shift_hour_reviews columns present (${cols.length}/10)`, cols.length === 10);

// 2 — one-review-per-placement: unique index on placement_id
const idx = await sql`
  SELECT indexname FROM pg_indexes
  WHERE tablename='shift_hour_reviews' AND indexname='shift_hour_reviews_placement_unique'`;
ok("unique index on placement_id present (one review per placement)", idx.length === 1);

// 3 — owner-attention "flagged" predicate (pure boolean; no real-table writes).
//     flagged = asDescribed===false || gotBreak===false || workedExtraHours===true || issueNote present
async function flagged(asDescribed, gotBreak, workedExtra, note) {
  const r = await sql`
    SELECT (${asDescribed}::boolean IS FALSE
         OR ${gotBreak}::boolean IS FALSE
         OR ${workedExtra}::boolean IS TRUE
         OR NULLIF(${note}::text, '') IS NOT NULL) AS flag`;
  return r[0]?.flag === true;
}
ok("clean shift (all good, no note) → no owner alert", (await flagged(true, true, false, "")) === false);
ok("not as described → owner alert", (await flagged(false, true, false, "")) === true);
ok("no break → owner alert", (await flagged(true, false, false, "")) === true);
ok("extra hours worked → owner alert", (await flagged(true, true, true, "")) === true);
ok("free issue note → owner alert", (await flagged(true, true, false, "ze lieten me langer doorwerken")) === true);
ok("unanswered (all null), no note → no owner alert", (await flagged(null, null, null, "")) === false);

console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
