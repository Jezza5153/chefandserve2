// Backend-audit remediation smoke — covers the 2026-06 audit fixes:
//   #1  client_submissions client_id ownership FK (cross-tenant scoping)
//   #5  deliver-outbox worker: acks `internal`, defers `payroll`, writes a run
//   #6  hours-reminders worker: default-OFF safety gate (no sends on demo data)
//
// Non-destructive + idempotent: every row it inserts carries a SMOKE marker and
// is deleted in `finally`, even on assertion failure. Run against the dev branch:
//   node scripts/smoke-backend-audit.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

let pass = 0;
let fail = 0;
function assert(name, cond, detail) {
  if (cond) {
    console.log("  ✓", name);
    pass++;
  } else {
    console.log("  ✗", name, detail ? `— ${detail}` : "");
    fail++;
  }
}

const SHARED = `SMOKE_SHARED_${randomUUID().slice(0, 8)}`;
const tag = `smoke-audit-${randomUUID().slice(0, 8)}`;
const cleanup = { submissionIds: [], outboxIds: [], runIds: [] };

try {
  /* ===== #1 — client_submissions client_id scoping ===== */
  console.log("── #1 client_submissions ownership FK ──");
  const clients = await sql`SELECT id, company_name FROM clients ORDER BY created_at LIMIT 2`;
  if (clients.length < 2) {
    console.log("  ⚠ need ≥2 clients in the DB to test scoping — skipping #1");
  } else {
    const [A, B] = clients;
    // Two portal submissions with the SAME fabricated company_name but different
    // owners — the exact cross-tenant collision the FK closes.
    for (const owner of [A, B]) {
      const [row] = await sql`
        INSERT INTO client_submissions
          (external_id, source, client_id, raw_payload, company_name, status)
        VALUES (${`${tag}-${owner.id}`}, 'client_portal', ${owner.id},
                ${JSON.stringify({ via: "client_portal", smoke: true })}::jsonb,
                ${SHARED}, 'triaged')
        RETURNING id`;
      cleanup.submissionIds.push(row.id);
    }

    // OLD (buggy) scope by company_name → both rows leak across tenants.
    const [byName] = await sql`
      SELECT count(*)::int n FROM client_submissions
      WHERE source='client_portal' AND company_name=${SHARED}`;
    assert("company_name scope returns BOTH (proves the old hole)", byName.n === 2, `got ${byName.n}`);

    // NEW scope by client_id → each tenant sees only their own.
    const [aOwn] = await sql`
      SELECT count(*)::int n FROM client_submissions
      WHERE source='client_portal' AND client_id=${A.id} AND company_name=${SHARED}`;
    const [bSeesA] = await sql`
      SELECT count(*)::int n FROM client_submissions
      WHERE source='client_portal' AND client_id=${B.id} AND company_name=${SHARED}
        AND external_id=${`${tag}-${A.id}`}`;
    assert("client_id scope returns ONLY own row", aOwn.n === 1, `got ${aOwn.n}`);
    assert("client B cannot see client A's submission", bSeesA.n === 0, `got ${bSeesA.n}`);

    // cancelClientSubmission ownership predicate (source + client_id).
    const aSubId = cleanup.submissionIds[0];
    const [okOwner] = await sql`
      SELECT count(*)::int n FROM client_submissions
      WHERE id=${aSubId} AND source='client_portal' AND client_id=${A.id}`;
    const [wrongOwner] = await sql`
      SELECT count(*)::int n FROM client_submissions
      WHERE id=${aSubId} AND source='client_portal' AND client_id=${B.id}`;
    assert("retract guard: real owner matches", okOwner.n === 1);
    assert("retract guard: other tenant blocked (0 rows)", wrongOwner.n === 0);
  }

  /* ===== #5 — deliver-outbox worker ===== */
  console.log("── #5 deliver-outbox worker ──");
  const intKey = `${tag}:internal`;
  const payKey = `${tag}:payroll`;
  const [intRow] = await sql`
    INSERT INTO integration_outbox (provider, event_type, entity_type, entity_id, payload_json, idempotency_key)
    VALUES ('internal', 'smoke.audit', 'smoke', ${randomUUID()}, '{}'::jsonb, ${intKey})
    RETURNING id`;
  const [payRow] = await sql`
    INSERT INTO integration_outbox (provider, event_type, entity_type, entity_id, payload_json, idempotency_key)
    VALUES ('payroll', 'smoke.audit', 'smoke', ${randomUUID()}, '{}'::jsonb, ${payKey})
    RETURNING id`;
  cleanup.outboxIds.push(intRow.id, payRow.id);

  execSync("npx tsx workers/deliver-outbox.ts", { stdio: "pipe" });

  const [intAfter] = await sql`SELECT status, sent_at, run_id FROM integration_outbox WHERE id=${intRow.id}`;
  const [payAfter] = await sql`SELECT status FROM integration_outbox WHERE id=${payRow.id}`;
  assert("internal row delivered (status=sent)", intAfter.status === "sent", intAfter.status);
  assert("internal row stamped sent_at", Boolean(intAfter.sent_at));
  assert("internal row linked to a run", Boolean(intAfter.run_id));
  assert("payroll row deferred (still pending)", payAfter.status === "pending", payAfter.status);
  if (intAfter.run_id) {
    cleanup.runIds.push(intAfter.run_id);
    const [run] = await sql`SELECT provider, run_type, status, success_count FROM integration_runs WHERE id=${intAfter.run_id}`;
    assert("integration_runs row written (cron/success)", run?.run_type === "cron" && run?.status === "success", JSON.stringify(run));
    assert("run success_count >= 1", (run?.success_count ?? 0) >= 1);
  }

  // Idempotency: a second pass delivers nothing new (internal already sent).
  execSync("npx tsx workers/deliver-outbox.ts", { stdio: "pipe" });
  const [intRerun] = await sql`SELECT status FROM integration_outbox WHERE id=${intRow.id}`;
  assert("re-run is idempotent (internal stays sent, not re-claimed)", intRerun.status === "sent");

  /* ===== #6 — hours-reminders safety gate ===== */
  console.log("── #6 hours-reminders default-OFF gate ──");
  const [{ n: beforeAudit }] = await sql`
    SELECT count(*)::int n FROM audit_log WHERE action LIKE 'shift_hours.reminder%' AND created_at > now() - interval '2 minutes'`;
  let gateExit = 0;
  try {
    // Explicitly unset the enable flag for this invocation.
    execSync("npx tsx workers/hours-reminders.ts", {
      stdio: "pipe",
      env: { ...process.env, HOURS_REMINDERS_ENABLED: "false" },
    });
  } catch (e) {
    gateExit = e.status ?? 1;
  }
  const [{ n: afterAudit }] = await sql`
    SELECT count(*)::int n FROM audit_log WHERE action LIKE 'shift_hours.reminder%' AND created_at > now() - interval '2 minutes'`;
  assert("hours-reminders exits 0 when disabled", gateExit === 0);
  assert("hours-reminders sends nothing when disabled", afterAudit === beforeAudit, `${beforeAudit}→${afterAudit}`);
} finally {
  // ----- cleanup (always) -----
  for (const id of cleanup.submissionIds) {
    await sql`DELETE FROM client_submissions WHERE id=${id}`;
  }
  for (const id of cleanup.outboxIds) {
    await sql`DELETE FROM integration_outbox WHERE id=${id}`;
  }
  for (const id of cleanup.runIds) {
    await sql`DELETE FROM integration_runs WHERE id=${id}`;
  }
  await sql`DELETE FROM audit_log WHERE action='integration.outbox_delivered' AND created_at > now() - interval '5 minutes' AND resource_id = ANY(${cleanup.runIds.length ? cleanup.runIds : ["00000000-0000-0000-0000-000000000000"]})`;
}

console.log(`\n=== backend-audit smoke: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
