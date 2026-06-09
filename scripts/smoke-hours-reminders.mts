/**
 * hours-reminders worker smoke (PR-INTEL-HARDEN).
 *
 * Drives the REAL worker (workers/hours-reminders.ts) as a subprocess against
 * isolated fixtures and proves the escalation ladder + its safety properties:
 *   - GATE: default-off (no business_settings flag) → the worker sends/writes nothing
 *   - TIER 1: a >24h draft → a chef-nudge audit breadcrumb (stage '24h')
 *   - TIER 2: a >5d submitted → a klant-reminder breadcrumb (stage 'klant_5d')
 *   - IDEMPOTENT: a second run writes NO duplicate breadcrumb (the alreadySent guard)
 *
 * SAFE: email is force-disabled (RESEND_API_KEY="") in the subprocess env, so the
 * worker sends nothing — it still writes the breadcrumb, which is what we assert.
 * DEV is verified clean (no other stale rows), so only our fixtures are processed.
 * All fixtures + breadcrumbs + the flag are torn down in `finally`.
 *
 *   npx tsx scripts/smoke-hours-reminders.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { execSync } from "node:child_process";

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL_UNPOOLED!);

const MARK = `HRSMK_${crypto.randomUUID()}`;
const uuid = () => crypto.randomUUID();

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log("  ✓", name);
    pass++;
  } else {
    console.log("  ✗", name, detail ? `— ${detail}` : "");
    fail++;
  }
}

/** Run the actual worker; email + kill-switch neutralised, output suppressed. */
function runWorker(): void {
  execSync("npx tsx workers/hours-reminders.ts", {
    env: {
      ...process.env,
      HOURS_REMINDERS_ENABLED: "", // clear the ops kill-switch (≠ "false")
      RESEND_API_KEY: "", // force sendPlainEmail → no-op (nothing sends)
      RESEND_FROM_EMAIL: "",
    },
    stdio: "pipe",
  });
}

async function breadcrumbStage(hoursId: string, action: string): Promise<string[]> {
  const rows = (await sql`
    SELECT after->>'stage' AS stage FROM audit_log
    WHERE resource = 'shift_hours' AND resource_id = ${hoursId} AND action = ${action}
  `) as Array<{ stage: string }>;
  return rows.map((r) => r.stage);
}

const chefId = uuid();
const clientId = uuid();
const dShiftId = uuid();
const dPlacementId = uuid();
const sShiftId = uuid();
const sPlacementId = uuid();
let dHoursId = "";
let sHoursId = "";

try {
  console.log("=== hours-reminders worker smoke ===\n");

  await sql`INSERT INTO chefs (id, full_name, email) VALUES (${chefId}, ${`${MARK} Chef`}, ${"delivered@resend.dev"})`;
  await sql`INSERT INTO clients (id, company_name, email) VALUES (${clientId}, ${`${MARK} BV`}, ${"delivered@resend.dev"})`;

  // TIER 1 fixture — a draft hours row created 25h ago (chef 24h nudge).
  await sql`INSERT INTO shifts (id, client_id, starts_at, ends_at, role_needed, status)
    VALUES (${dShiftId}, ${clientId}, now() - interval '3 days', now() - interval '3 days' + interval '4 hours', 'chef_de_partie', 'completed')`;
  await sql`INSERT INTO placements (id, shift_id, chef_id, status) VALUES (${dPlacementId}, ${dShiftId}, ${chefId}, 'completed')`;
  const dr = (await sql`INSERT INTO shift_hours
    (placement_id, shift_id, chef_id, client_id, started_at, ended_at, worked_minutes, chef_rate_cents, client_rate_cents, status, created_at)
    VALUES (${dPlacementId}, ${dShiftId}, ${chefId}, ${clientId}, now() - interval '3 days', now() - interval '3 days' + interval '4 hours', 240, 3000, 5000, 'draft', now() - interval '25 hours')
    RETURNING id`) as Array<{ id: string }>;
  dHoursId = dr[0].id;

  // TIER 2 fixture — a submitted hours row submitted 6d ago (klant 5d reminder).
  await sql`INSERT INTO shifts (id, client_id, starts_at, ends_at, role_needed, status)
    VALUES (${sShiftId}, ${clientId}, now() - interval '8 days', now() - interval '8 days' + interval '4 hours', 'chef_de_partie', 'completed')`;
  await sql`INSERT INTO placements (id, shift_id, chef_id, status) VALUES (${sPlacementId}, ${sShiftId}, ${chefId}, 'completed')`;
  const sr = (await sql`INSERT INTO shift_hours
    (placement_id, shift_id, chef_id, client_id, started_at, ended_at, worked_minutes, chef_rate_cents, client_rate_cents, status, submitted_at, created_at)
    VALUES (${sPlacementId}, ${sShiftId}, ${chefId}, ${clientId}, now() - interval '8 days', now() - interval '8 days' + interval '4 hours', 240, 3000, 5000, 'submitted', now() - interval '6 days', now() - interval '8 days')
    RETURNING id`) as Array<{ id: string }>;
  sHoursId = sr[0].id;

  // ---- GATE: default off (no flag row) → the worker must do nothing ----
  runWorker();
  assert(
    "gate: default-off → no chef breadcrumb",
    (await breadcrumbStage(dHoursId, "shift_hours.reminder_chef")).length === 0,
  );
  assert(
    "gate: default-off → no klant breadcrumb",
    (await breadcrumbStage(sHoursId, "shift_hours.reminder_klant")).length === 0,
  );

  // ---- enable the flag, run the ladder ----
  await sql`INSERT INTO business_settings (key, value) VALUES ('hours_reminders', ${JSON.stringify({ enabled: true })}::jsonb)`;
  runWorker();
  const chefStages = await breadcrumbStage(dHoursId, "shift_hours.reminder_chef");
  assert("tier 1: chef 24h nudge breadcrumb written", chefStages.length === 1 && chefStages[0] === "24h", JSON.stringify(chefStages));
  const klantStages = await breadcrumbStage(sHoursId, "shift_hours.reminder_klant");
  assert("tier 2: klant 5d reminder breadcrumb written", klantStages.length === 1 && klantStages[0] === "klant_5d", JSON.stringify(klantStages));

  // ---- idempotency: a second run must NOT double-send ----
  runWorker();
  assert("idempotent: chef breadcrumb still 1 after re-run", (await breadcrumbStage(dHoursId, "shift_hours.reminder_chef")).length === 1);
  assert("idempotent: klant breadcrumb still 1 after re-run", (await breadcrumbStage(sHoursId, "shift_hours.reminder_klant")).length === 1);
} finally {
  const ids = [dHoursId || "x", sHoursId || "x"];
  await sql`DELETE FROM audit_log WHERE resource = 'shift_hours' AND resource_id IN (${ids[0]}, ${ids[1]})`;
  await sql`DELETE FROM shift_hours WHERE client_id = ${clientId}`;
  await sql`DELETE FROM placements WHERE chef_id = ${chefId}`;
  await sql`DELETE FROM shifts WHERE client_id = ${clientId}`;
  await sql`DELETE FROM business_settings WHERE key = 'hours_reminders'`;
  await sql`DELETE FROM chefs WHERE id = ${chefId}`;
  await sql`DELETE FROM clients WHERE id = ${clientId}`;
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
