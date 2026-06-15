/**
 * Smoke — chef PR-9a payment status + vacation estimate. Read-only + non-mutating.
 *
 * 1. The read-model's source columns exist (shift_hours status/workedMinutes/rate).
 * 2. The hours-status → payout-stage mapping (mirrors stageOf in chef-payments.ts)
 *    is exhaustive and correct for every enum value.
 * 3. The chef-amount math (round(minutes/60 × rateCents)) and the 8% vakantiegeld
 *    accrual match computeChefAmountCents / MONEY_ASSUMPTIONS.vacationPct.
 *
 * Run (dev only): node --env-file=.env.local scripts/smoke-chef-pr9a-payment-status.mjs
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
  WHERE table_name='shift_hours'
    AND column_name IN ('status','worked_minutes','chef_rate_cents','chef_id')`;
ok(`shift_hours source columns present (${cols.length}/4)`, cols.length === 4);

// 2 — status → payout stage mapping (mirror stageOf). The enum is the contract.
const enumVals = await sql`
  SELECT e.enumlabel AS v
  FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE t.typname = 'shift_hours_status' ORDER BY e.enumsortorder`;
const dbStatuses = new Set(enumVals.map((r) => r.v));
const stageOf = (s) =>
  ({
    draft: "to_submit",
    submitted: "awaiting_client",
    client_signed: "awaiting_office",
    admin_approved: "approved",
    exported: "paid_out",
    client_rejected: "rejected",
    admin_rejected: "rejected",
    void: null,
  })[s];
// every DB enum value is handled (mapped to a stage or explicitly null), none missing
const handled = [...dbStatuses].every((s) => stageOf(s) !== undefined);
ok(`every shift_hours_status enum value is mapped (${dbStatuses.size} values)`, handled);
ok("draft → to_submit", stageOf("draft") === "to_submit");
ok("submitted → awaiting_client", stageOf("submitted") === "awaiting_client");
ok("admin_approved → approved", stageOf("admin_approved") === "approved");
ok("exported → paid_out", stageOf("exported") === "paid_out");
ok("client_rejected → rejected", stageOf("client_rejected") === "rejected");
ok("void → null (excluded)", stageOf("void") === null);

// 3 — amount + vacation math (pure)
const amt = (min, rate) => Math.round((min / 60) * rate);
ok("8h @ €25/u = €200,00", amt(480, 2500) === 20000);
ok("7h30 @ €30/u = €225,00", amt(450, 3000) === 22500);
ok("0 min = €0", amt(0, 3000) === 0);
const VAC_PCT = 8; // MONEY_ASSUMPTIONS.vacationPct
ok("vakantiegeld 8% of €200 = €16,00", Math.round(20000 * (VAC_PCT / 100)) === 1600);

console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
