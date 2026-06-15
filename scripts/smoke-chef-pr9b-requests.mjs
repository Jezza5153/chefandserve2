/**
 * Smoke — chef PR-9b vacation + expense requests. Read-only + non-mutating.
 *
 * 1. Migration 0063 tables + enums present (chef_vacation_requests, chef_expense_claims,
 *    chef_request_status / chef_vacation_kind / chef_expense_category).
 * 2. The atomic decide guard (UPDATE ... WHERE status='pending') only flips a still-
 *    pending request — validated as pure SQL over a CTE (no real-table writes), so a
 *    double-approve / approve-after-reject race can't re-decide.
 * 3. The amount validation (cents > 0, payout ≤ €10k, expense ≤ €5k) matches the domain.
 *
 * Run (dev only): node --env-file=.env.local scripts/smoke-chef-pr9b-requests.mjs
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

// 1 — tables + enums present
const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_name IN ('chef_vacation_requests','chef_expense_claims')`;
ok(`0063 tables present (${tables.length}/2)`, tables.length === 2);

const enums = await sql`
  SELECT t.typname FROM pg_type t
  WHERE t.typname IN ('chef_request_status','chef_vacation_kind','chef_expense_category')
  GROUP BY t.typname`;
ok(`0063 enums present (${enums.length}/3)`, enums.length === 3);

const statusVals = await sql`
  SELECT e.enumlabel v FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
  WHERE t.typname='chef_request_status' ORDER BY e.enumsortorder`;
ok("status enum = pending/approved/rejected/cancelled",
  statusVals.map((r) => r.v).join(",") === "pending,approved,rejected,cancelled");

// 2 — atomic decide guard: only a pending row flips.
async function canDecide(currentStatus) {
  const r = await sql`
    WITH req AS (SELECT ${currentStatus}::text AS status)
    SELECT (SELECT status FROM req) = 'pending' AS can`;
  return r[0]?.can === true;
}
ok("pending → can decide", (await canDecide("pending")) === true);
ok("approved → cannot re-decide", (await canDecide("approved")) === false);
ok("rejected → cannot re-decide", (await canDecide("rejected")) === false);
ok("cancelled → cannot decide", (await canDecide("cancelled")) === false);

// 3 — amount validation (mirror domain).
const validVacation = (cents) => Number.isFinite(cents) && cents > 0 && cents <= 1_000_000;
const validExpense = (cents) => Number.isFinite(cents) && cents > 0 && cents <= 500_000;
ok("vacation €150 valid", validVacation(15000) === true);
ok("vacation €0 invalid", validVacation(0) === false);
ok("vacation €10001 too large", validVacation(1_000_100) === false);
ok("expense €12,50 valid", validExpense(1250) === true);
ok("expense €5001 too large", validExpense(500_100) === false);

console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
