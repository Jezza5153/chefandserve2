/**
 * Smoke — chef replacement-handover (R2#13). Read-only + non-mutating.
 *
 * 1. Supporting columns exist (shift_arrival_checks for the stop, notifications for
 *    the idempotency dedup).
 * 2. handoverApplies() (mirror replacement-handover.ts) fires ONLY for a chef who
 *    was committed (accepted/confirmed) — never for proposed/rejected/draft, so a
 *    chef who never accepted doesn't get a "don't show up" notice.
 *
 * Run (dev only): node --env-file=.env.local scripts/smoke-chef-replacement-handover.mjs
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

// 1 — supporting columns present
const arr = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='shift_arrival_checks' AND column_name IN ('shift_id','chef_id','status','stopped_at')`;
ok(`shift_arrival_checks stop columns present (${arr.length}/4)`, arr.length === 4);

const notif = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='notifications' AND column_name IN ('type','entity_id','created_at')`;
ok(`notifications dedup columns present (${notif.length}/3)`, notif.length === 3);

// 2 — handoverApplies (mirror replacement-handover.ts): only committed states.
const handoverApplies = (prior) => prior === "accepted" || prior === "confirmed";
ok("confirmed → handover applies", handoverApplies("confirmed") === true);
ok("accepted → handover applies", handoverApplies("accepted") === true);
ok("proposed → NO handover (never accepted)", handoverApplies("proposed") === false);
ok("rejected → NO handover", handoverApplies("rejected") === false);
ok("draft → NO handover", handoverApplies("draft") === false);
ok("null prior → NO handover", handoverApplies(null) === false);

console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
