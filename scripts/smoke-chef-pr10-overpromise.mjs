/**
 * Smoke — chef PR-10 overpromise read-model. Read-only + non-mutating.
 *
 * 1. The read-model's source columns exist (shift_hours actuals + shifts planned +
 *    shift_hour_reviews flags).
 * 2. The composite overpromise score + MIN_SAMPLE filter (mirror getOverpromiseByClient)
 *    behave correctly: a clean client scores 0, a chronically-overrunning + off-brief +
 *    won't-return client scores high, the score is clamped 0..100, and a below-sample
 *    client is excluded. Pure JS — no DB writes.
 *
 * Run (dev only): node --env-file=.env.local scripts/smoke-chef-pr10-overpromise.mjs
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

const MIN_SAMPLE = 3;

// 1 — source columns present
const cols = await sql`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE (table_name='shift_hours' AND column_name IN ('worked_minutes','submitted_at','status','client_id'))
     OR (table_name='shift_hour_reviews' AND column_name IN ('as_described','got_break','would_return'))
     OR (table_name='shifts' AND column_name IN ('starts_at','ends_at'))`;
ok(`overpromise source columns present (${cols.length}/9)`, cols.length === 9);

// 2 — composite score (mirror getOverpromiseByClient).
const pct = (n, d) => (d > 0 ? n / d : 0);
function score({ shifts, reviews, overrunShifts, offBrief, noBreak, wontReturn }) {
  if (shifts < MIN_SAMPLE) return null; // excluded
  const overrunRate = pct(overrunShifts, shifts);
  const offBriefRate = pct(offBrief, reviews);
  const noBreakRate = pct(noBreak, reviews);
  const wontReturnRate = pct(wontReturn, reviews);
  return Math.round(
    100 * Math.min(1, 0.35 * overrunRate + 0.25 * offBriefRate + 0.2 * noBreakRate + 0.2 * wontReturnRate),
  );
}

ok("clean client (no flags) → score 0",
  score({ shifts: 10, reviews: 10, overrunShifts: 0, offBrief: 0, noBreak: 0, wontReturn: 0 }) === 0);
ok("below MIN_SAMPLE → excluded (null)",
  score({ shifts: 2, reviews: 2, overrunShifts: 2, offBrief: 2, noBreak: 2, wontReturn: 2 }) === null);
ok("worst-case all-flagged → score 100 (clamped)",
  score({ shifts: 10, reviews: 10, overrunShifts: 10, offBrief: 10, noBreak: 10, wontReturn: 10 }) === 100);
ok("half overrun only → score 18 (0.35×0.5×100≈17.5→18)",
  score({ shifts: 10, reviews: 10, overrunShifts: 5, offBrief: 0, noBreak: 0, wontReturn: 0 }) === 18);
ok("all off-brief only → score 25 (0.25×1×100)",
  score({ shifts: 10, reviews: 10, overrunShifts: 0, offBrief: 10, noBreak: 0, wontReturn: 0 }) === 25);
ok("flags with zero reviews → rates 0, only overrun counts",
  score({ shifts: 5, reviews: 0, overrunShifts: 5, offBrief: 0, noBreak: 0, wontReturn: 0 }) === 35);

console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
