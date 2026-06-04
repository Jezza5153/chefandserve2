/**
 * KPI-1 smoke — the per-day metrics snapshot worker + read-model, against the real DB.
 *   DATABASE_URL_UNPOOLED='<neon-clone>' npx tsx scripts/smoke-metrics-snapshot.mts
 *
 * Proves:
 *  - FINAL-only honesty: hours/money count ONLY admin_approved/exported shift_hours
 *    (a draft 600m row must NOT appear) — mirrors chef-history.ts.
 *  - every snapshot column (hours/pay/revenue/margin, completed shifts, rating sum/count,
 *    reliability rollups + response-time, client fill + spend + approval SLA).
 *  - the worker is IDEMPOTENT (run twice → still exactly one row per (entity, day),
 *    identical values).
 *  - metrics-history read-model: getChefDailySeries returns the row; the pure
 *    re-shapers (bucketByWeek / windowSum / weightedAvg / periodDelta) are correct
 *    with a fixed `today`.
 * Seeds throwaway rows on a fixed date; self-cleaning; safe to re-run.
 */
import { spawn } from "node:child_process";
import { config } from "dotenv";
config({ path: ".env.local" });

const DB = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!;
const { neon } = await import("@neondatabase/serverless");
const sql = neon(DB);
const mh = await import("@/lib/domain/metrics-history");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

const D = "2026-05-20"; // all seeded activity lands on this date
const uuid = () => crypto.randomUUID();
const ts = Date.now();
const chefId = uuid();
const clientId = uuid();
const s1 = uuid(); // completed shift, FINAL hours
const s2 = uuid(); // open shift, DRAFT hours (must be excluded from money)
const p1 = uuid();
const p2 = uuid();

/** Spawn the real worker for a date; resolve its exit code. */
function runWorker(date: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "workers/metrics-snapshot.ts", `--date=${date}`], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL_UNPOOLED: DB },
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

console.log("=== KPI-1 metrics-snapshot smoke ===\n");

try {
  console.log("── seed (all activity on", D, ") ──");
  await sql`INSERT INTO chefs (id, full_name, status) VALUES (${chefId}, ${`SMOKE KPI Chef ${ts}`}, 'active')`;
  await sql`INSERT INTO clients (id, company_name, status) VALUES (${clientId}, ${`SMOKE KPI Hotel ${ts}`}, 'active')`;
  await sql`INSERT INTO shifts (id, client_id, starts_at, ends_at, role_needed, segment, status, headcount) VALUES
    (${s1}, ${clientId}, ${`${D} 10:00:00+02`}, ${`${D} 15:00:00+02`}, 'chef_de_partie', 'hotel', 'completed', 1),
    (${s2}, ${clientId}, ${`${D} 18:00:00+02`}, ${`${D} 23:00:00+02`}, 'chef_de_partie', 'hotel', 'open', 1)`;
  await sql`INSERT INTO placements (id, shift_id, chef_id, status) VALUES
    (${p1}, ${s1}, ${chefId}, 'completed'),
    (${p2}, ${s2}, ${chefId}, 'proposed')`;
  // FINAL hours on s1 (300m @ €40 chef / €60 client; approved D 16:00, client-signed D 12:00 → 240m SLA)
  // + DRAFT hours on s2 (600m) which MUST be excluded from all money/hours.
  await sql`INSERT INTO shift_hours
      (placement_id, shift_id, chef_id, client_id, started_at, ended_at, break_minutes, worked_minutes,
       chef_rate_cents, client_rate_cents, status, client_signed_at, admin_approved_at) VALUES
    (${p1}, ${s1}, ${chefId}, ${clientId}, ${`${D} 10:00:00+02`}, ${`${D} 15:00:00+02`}, 0, 300,
       4000, 6000, 'admin_approved', ${`${D} 12:00:00+02`}, ${`${D} 16:00:00+02`}),
    (${p2}, ${s2}, ${chefId}, ${clientId}, ${`${D} 18:00:00+02`}, ${`${D} 23:00:00+02`}, 0, 600,
       4000, 6000, 'draft', NULL, NULL)`;
  // rating given on D
  await sql`INSERT INTO ratings (placement_id, chef_id, client_id, stars, tags, created_at) VALUES
    (${p1}, ${chefId}, ${clientId}, 5, '{op_tijd}', ${`${D} 17:00:00+02`})`;
  // chef_events on D: 2 accepted (120s,240s) + 1 rejected (600s) + 1 cancel + 1 hours_submitted
  await sql`INSERT INTO chef_events (chef_id, event_type, response_seconds, occurred_at) VALUES
    (${chefId}, 'proposal_accepted', 120, ${`${D} 09:00:00+02`}),
    (${chefId}, 'proposal_accepted', 240, ${`${D} 09:05:00+02`}),
    (${chefId}, 'proposal_rejected', 600, ${`${D} 09:10:00+02`}),
    (${chefId}, 'shift_cancelled_by_chef', NULL, ${`${D} 09:15:00+02`}),
    (${chefId}, 'hours_submitted', NULL, ${`${D} 21:00:00+02`})`;
  assert("seed complete", true);

  console.log("\n── run worker (1st) ──");
  const code1 = await runWorker(D);
  assert("worker exit 0", code1 === 0, `code ${code1}`);

  console.log("\n── chef_metrics_daily ──");
  const [c] = await sql`SELECT * FROM chef_metrics_daily WHERE chef_id=${chefId} AND snapshot_date=${D}`;
  assert("chef row written", Boolean(c));
  assert("hours = 300m (FINAL only; draft 600m excluded)", c?.hours_worked_minutes === 300, `got ${c?.hours_worked_minutes}`);
  assert("pay = 20000c (5h × €40)", c?.pay_cents === 20000, `got ${c?.pay_cents}`);
  assert("revenue = 30000c (5h × €60)", c?.revenue_cents === 30000, `got ${c?.revenue_cents}`);
  assert("margin = 10000c", c?.margin_cents === 10000, `got ${c?.margin_cents}`);
  assert("completedShifts = 1", c?.completed_shifts === 1, `got ${c?.completed_shifts}`);
  assert("ratingSum/Count = 5 / 1", c?.rating_sum === 5 && c?.rating_count === 1, `got ${c?.rating_sum}/${c?.rating_count}`);
  assert("proposalsAccepted = 2", c?.proposals_accepted === 2, `got ${c?.proposals_accepted}`);
  assert("proposalsRejected = 1", c?.proposals_rejected === 1, `got ${c?.proposals_rejected}`);
  assert("cancellations = 1", c?.cancellations === 1, `got ${c?.cancellations}`);
  assert("hoursSubmitted = 1", c?.hours_submitted === 1, `got ${c?.hours_submitted}`);
  assert("responseSecondsSum = 960 (120+240+600)", c?.response_seconds_sum === 960, `got ${c?.response_seconds_sum}`);
  assert("responseSecondsCount = 3", c?.response_seconds_count === 3, `got ${c?.response_seconds_count}`);

  console.log("\n── client_metrics_daily ──");
  const [k] = await sql`SELECT * FROM client_metrics_daily WHERE client_id=${clientId} AND snapshot_date=${D}`;
  assert("client row written", Boolean(k));
  assert("shiftsCount = 2", k?.shifts_count === 2, `got ${k?.shifts_count}`);
  assert("slotsCount = 2", k?.slots_count === 2, `got ${k?.slots_count}`);
  assert("filledSlots = 1 (p1 completed; p2 proposed excluded)", k?.filled_slots === 1, `got ${k?.filled_slots}`);
  assert("spend = 30000c (client rate)", k?.spend_cents === 30000, `got ${k?.spend_cents}`);
  assert("chefPay = 20000c", k?.chef_pay_cents === 20000, `got ${k?.chef_pay_cents}`);
  assert("margin = 10000c", k?.margin_cents === 10000, `got ${k?.margin_cents}`);
  assert("ratingSum/Count = 5 / 1", k?.rating_sum === 5 && k?.rating_count === 1, `got ${k?.rating_sum}/${k?.rating_count}`);
  assert("approvalSla = 240m / 1", k?.approval_sla_minutes_sum === 240 && k?.approval_sla_count === 1, `got ${k?.approval_sla_minutes_sum}/${k?.approval_sla_count}`);

  console.log("\n── idempotency (run worker 2nd) ──");
  const code2 = await runWorker(D);
  assert("worker exit 0 (re-run)", code2 === 0, `code ${code2}`);
  const [{ n: chefRows }] = await sql`SELECT count(*)::int AS n FROM chef_metrics_daily WHERE chef_id=${chefId} AND snapshot_date=${D}`;
  const [{ n: clientRows }] = await sql`SELECT count(*)::int AS n FROM client_metrics_daily WHERE client_id=${clientId} AND snapshot_date=${D}`;
  assert("still exactly 1 chef row (ON CONFLICT)", chefRows === 1, `got ${chefRows}`);
  assert("still exactly 1 client row (ON CONFLICT)", clientRows === 1, `got ${clientRows}`);
  const [c2] = await sql`SELECT pay_cents, hours_worked_minutes FROM chef_metrics_daily WHERE chef_id=${chefId} AND snapshot_date=${D}`;
  assert("values stable after re-run", c2?.pay_cents === 20000 && c2?.hours_worked_minutes === 300, `got ${c2?.pay_cents}/${c2?.hours_worked_minutes}`);

  console.log("\n── metrics-history read-model ──");
  const series = await mh.getChefDailySeries(chefId, 90);
  const row = series.find((r) => r.snapshotDate === D);
  assert("getChefDailySeries returns the D row", Boolean(row));
  assert("series row hours = 300", row?.hoursWorkedMinutes === 300, `got ${row?.hoursWorkedMinutes}`);
  // pure re-shapers with a fixed `today` (D is exactly 1 day before) for determinism:
  const today = new Date("2026-05-21T12:00:00Z");
  const weekly = mh.bucketByWeek(series, (r) => r.hoursWorkedMinutes, 8, today);
  assert("bucketByWeek puts 300 in the most-recent bucket", weekly[7] === 300, `got [${weekly.join(",")}]`);
  assert("windowSum(7d) hours = 300", mh.windowSum(series, (r) => r.hoursWorkedMinutes, 7, today) === 300);
  assert("weightedAvg rating = 5", mh.weightedAvg(series, (r) => r.ratingSum, (r) => r.ratingCount) === 5);
  const delta = mh.periodDelta(series, (r) => r.hoursWorkedMinutes, today);
  assert("periodDelta thisPeriod = 300, prev = 0 → hidden (noise guard)", delta.thisPeriod === 300 && delta.prevPeriod === 0 && delta.mode === "hidden", `${delta.thisPeriod}/${delta.prevPeriod}/${delta.mode}`);
} finally {
  console.log("\n── cleanup ──");
  await sql`DELETE FROM chef_metrics_daily WHERE chef_id=${chefId}`;
  await sql`DELETE FROM client_metrics_daily WHERE client_id=${clientId}`;
  await sql`DELETE FROM chef_events WHERE chef_id=${chefId}`;
  await sql`DELETE FROM ratings WHERE chef_id=${chefId}`;
  await sql`DELETE FROM shift_hours WHERE chef_id=${chefId}`;
  await sql`DELETE FROM placements WHERE chef_id=${chefId}`;
  await sql`DELETE FROM shifts WHERE id IN (${s1}, ${s2})`;
  await sql`DELETE FROM clients WHERE id=${clientId}`;
  await sql`DELETE FROM chefs WHERE id=${chefId}`;
  const [gone] = await sql`SELECT id FROM chefs WHERE id=${chefId}`;
  assert("cleanup removed smoke rows", !gone);
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
