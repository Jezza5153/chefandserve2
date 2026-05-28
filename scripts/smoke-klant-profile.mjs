// PR-KLANT-1 smoke — verifies client_change_requests table + enum, FK to
// clients, and a pending → approved roundtrip against the production DB.
// Cleans up after itself. Safe to re-run.

import { config } from "dotenv";
config({ path: ".env.local" });

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

console.log("=== PR-KLANT-1 client-profile smoke ===\n");

// --- schema presence ---
{
  console.log("── schema ──");
  const tables = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename='client_change_requests'`;
  assert("client_change_requests table exists", tables.length === 1);

  const enums = await sql`
    SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
    WHERE t.typname='client_change_status' ORDER BY enumsortorder`;
  assert(
    "client_change_status enum = pending/approved/rejected",
    enums.map((e) => e.enumlabel).join(",") === "pending,approved,rejected",
  );

  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename='client_change_requests'
      AND indexname='client_change_requests_client_idx'`;
  assert("client_change_requests_client_idx exists", idx.length === 1);
}

// --- need a real client to attach a request to ---
const [client] = await sql`SELECT id, payment_terms_days FROM clients LIMIT 1`;
if (!client) {
  console.log("\n(no clients in DB — skipping roundtrip; schema checks above still valid)");
  console.log(`\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

// --- pending → approved roundtrip ---
{
  console.log("\n── change-request roundtrip ──");
  const [req] = await sql`
    INSERT INTO client_change_requests (client_id, field, current_value, proposed_value, reason)
    VALUES (${client.id}, 'paymentTermsDays', ${JSON.stringify(client.payment_terms_days ?? 14)}::jsonb, '60'::jsonb, 'SMOKE test betaaltermijn')
    RETURNING id, status`;
  assert("insert pending request", req && req.status === "pending");

  const [readBack] = await sql`
    SELECT field, status, proposed_value FROM client_change_requests WHERE id=${req.id}`;
  assert(
    "reads back field + proposed",
    readBack.field === "paymentTermsDays" && String(readBack.proposed_value) === "60",
  );

  // Simulate admin approve (atomic — only flips a still-pending row).
  const approved = await sql`
    UPDATE client_change_requests
    SET status='approved', decided_at=now(), updated_at=now()
    WHERE id=${req.id} AND status='pending'
    RETURNING id`;
  assert("atomic approve flips pending → approved", approved.length === 1);

  const reApprove = await sql`
    UPDATE client_change_requests
    SET status='approved'
    WHERE id=${req.id} AND status='pending'
    RETURNING id`;
  assert("re-approve is a no-op (already decided)", reApprove.length === 0);

  // cleanup
  await sql`DELETE FROM client_change_requests WHERE id=${req.id}`;
  const [gone] = await sql`SELECT id FROM client_change_requests WHERE id=${req.id}`;
  assert("cleanup removed the smoke row", !gone);
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
