/**
 * Smoke — chef PR-4b owner clock-out digest. Read-only + non-mutating.
 *
 * 1. The read-model's source tables/columns are present (shift_hours actuals +
 *    shift_hour_reviews flags + shifts planned window).
 * 2. The planned-vs-actual + attention predicate (mirrors getClockoutSignals)
 *    evaluates correctly across the key cases — validated as pure SQL boolean
 *    logic over CTEs, so it never writes to real tables. An item needs attention
 *    when: overrun >= 45 min, OR review flags off-brief / no-break / extra-hours /
 *    won't-return, OR a free issue note is present.
 *
 * Run (dev only): node --env-file=.env.local scripts/smoke-chef-pr4b-clockout-digest.mjs
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

const OVERRUN = 45; // OVERRUN_THRESHOLD_MIN in clockout-signals.ts

// 1 — source columns present
const cols = await sql`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE (table_name='shift_hours' AND column_name IN ('worked_minutes','submitted_at','status'))
     OR (table_name='shift_hour_reviews' AND column_name IN ('as_described','got_break','worked_extra_hours','would_return','issue_note'))
     OR (table_name='shifts' AND column_name IN ('starts_at','ends_at'))`;
ok(`read-model source columns present (${cols.length}/10)`, cols.length === 10);

// 2 — planned-vs-actual + attention predicate (CTE; no real-table writes).
//     plannedMin from starts/ends, overrun = actual - planned.
async function needsAttention({ plannedMin, actualMin, asDescribed, gotBreak, extra, wouldReturn, note }) {
  const r = await sql`
    WITH x AS (
      SELECT ${actualMin}::int - ${plannedMin}::int AS overrun,
             ${asDescribed}::boolean AS as_described,
             ${gotBreak}::boolean AS got_break,
             ${extra}::boolean AS extra,
             ${wouldReturn}::boolean AS would_return,
             NULLIF(${note}::text, '') AS note)
    SELECT (overrun >= ${OVERRUN}
         OR as_described IS FALSE
         OR got_break IS FALSE
         OR extra IS TRUE
         OR would_return IS FALSE
         OR note IS NOT NULL) AS flag
    FROM x`;
  return r[0]?.flag === true;
}

ok("on-time, clean review → no attention",
  (await needsAttention({ plannedMin: 480, actualMin: 480, asDescribed: true, gotBreak: true, extra: false, wouldReturn: true, note: "" })) === false);
ok("45-min overrun → attention",
  (await needsAttention({ plannedMin: 480, actualMin: 525, asDescribed: true, gotBreak: true, extra: false, wouldReturn: true, note: "" })) === true);
ok("44-min overrun → still under threshold, no attention",
  (await needsAttention({ plannedMin: 480, actualMin: 524, asDescribed: true, gotBreak: true, extra: false, wouldReturn: true, note: "" })) === false);
ok("ran short → no attention",
  (await needsAttention({ plannedMin: 480, actualMin: 400, asDescribed: true, gotBreak: true, extra: false, wouldReturn: true, note: "" })) === false);
ok("off-brief review → attention",
  (await needsAttention({ plannedMin: 480, actualMin: 480, asDescribed: false, gotBreak: true, extra: false, wouldReturn: true, note: "" })) === true);
ok("no break → attention",
  (await needsAttention({ plannedMin: 480, actualMin: 480, asDescribed: true, gotBreak: false, extra: false, wouldReturn: true, note: "" })) === true);
ok("won't-return → attention",
  (await needsAttention({ plannedMin: 480, actualMin: 480, asDescribed: true, gotBreak: true, extra: false, wouldReturn: false, note: "" })) === true);
ok("free note only → attention",
  (await needsAttention({ plannedMin: 480, actualMin: 480, asDescribed: true, gotBreak: true, extra: false, wouldReturn: true, note: "ingang was lastig" })) === true);
ok("no review (all null), on-time → no attention",
  (await needsAttention({ plannedMin: 480, actualMin: 480, asDescribed: null, gotBreak: null, extra: null, wouldReturn: null, note: "" })) === false);

console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
