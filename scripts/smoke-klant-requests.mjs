// PR-KLANT-2 smoke — verifies client_shift_change_requests table + enums,
// the submission_status 'cancelled_by_client' value, client_submissions cancel
// columns, and the one-open-request-per-shift-per-kind partial unique index.
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

console.log("=== PR-KLANT-2 requests/change-cancel smoke ===\n");

// --- schema presence ---
{
  console.log("── schema ──");
  const tables = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename='client_shift_change_requests'`;
  assert("client_shift_change_requests table exists", tables.length === 1);

  const subEnum = await sql`
    SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
    WHERE t.typname='submission_status' AND enumlabel='cancelled_by_client'`;
  assert("submission_status has cancelled_by_client", subEnum.length === 1);

  const kindEnum = await sql`
    SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
    WHERE t.typname='client_shift_change_kind' ORDER BY enumsortorder`;
  assert(
    "client_shift_change_kind = change/cancel",
    kindEnum.map((e) => e.enumlabel).join(",") === "change,cancel",
  );

  const statusEnum = await sql`
    SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
    WHERE t.typname='client_shift_change_status' ORDER BY enumsortorder`;
  assert(
    "client_shift_change_status = pending/in_progress/approved/rejected",
    statusEnum.map((e) => e.enumlabel).join(",") === "pending,in_progress,approved,rejected",
  );

  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='client_submissions'
      AND column_name IN ('cancelled_by_client_at','cancelled_by_client_reason')`;
  assert("client_submissions has cancel columns", cols.length === 2);

  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename='client_shift_change_requests'
      AND indexname='client_shift_change_open_unique'`;
  assert("partial unique index client_shift_change_open_unique exists", idx.length === 1);
}

// --- need a real shift + client to exercise the table ---
const [shift] = await sql`SELECT id, client_id FROM shifts WHERE client_id IS NOT NULL LIMIT 1`;
if (!shift) {
  console.log("\n(no shifts with a client in DB — skipping roundtrip; schema checks above still valid)");
  console.log(`\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

// --- one-open-per-shift-per-kind + decision roundtrip ---
{
  console.log("\n── change-request roundtrip + duplicate guard ──");
  const [req] = await sql`
    INSERT INTO client_shift_change_requests (shift_id, client_id, kind, reason)
    VALUES (${shift.id}, ${shift.client_id}, 'change', 'SMOKE change request')
    RETURNING id, status`;
  assert("insert pending change request", req && req.status === "pending");

  // Second OPEN 'change' request for the same shift must violate the unique idx.
  let dupRejected = false;
  try {
    await sql`
      INSERT INTO client_shift_change_requests (shift_id, client_id, kind, reason)
      VALUES (${shift.id}, ${shift.client_id}, 'change', 'SMOKE duplicate')`;
  } catch {
    dupRejected = true;
  }
  assert("second open 'change' rejected by partial unique index", dupRejected);

  // A 'cancel' request for the same shift is allowed (different kind).
  const [cancelReq] = await sql`
    INSERT INTO client_shift_change_requests (shift_id, client_id, kind, reason)
    VALUES (${shift.id}, ${shift.client_id}, 'cancel', 'SMOKE cancel request')
    RETURNING id`;
  assert("different kind ('cancel') allowed for same shift", Boolean(cancelReq?.id));

  // Resolve the change request → a NEW open 'change' is then allowed.
  await sql`UPDATE client_shift_change_requests SET status='approved', decided_at=now() WHERE id=${req.id}`;
  const [reopened] = await sql`
    INSERT INTO client_shift_change_requests (shift_id, client_id, kind, reason)
    VALUES (${shift.id}, ${shift.client_id}, 'change', 'SMOKE reopened')
    RETURNING id`;
  assert("new 'change' allowed after prior one resolved", Boolean(reopened?.id));

  // cleanup
  await sql`DELETE FROM client_shift_change_requests WHERE reason LIKE 'SMOKE%' AND shift_id=${shift.id}`;
  const leftovers = await sql`
    SELECT id FROM client_shift_change_requests WHERE reason LIKE 'SMOKE%' AND shift_id=${shift.id}`;
  assert("cleanup removed all smoke rows", leftovers.length === 0);
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
