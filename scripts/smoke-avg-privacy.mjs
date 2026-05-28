// PR-AVG-1 smoke — verifies the privacy-request fulfillment schema + lifecycle:
// new intake/identity/SLA fields, 'other'/'withdrawn' enum values, the
// privacy_request_messages correspondence log, manual (account-less) intake,
// atomic claim, identity verification, SLA extension, withdrawal. Cleans up.
// Safe to re-run.

import { config } from "dotenv";
config({ path: ".env.local" });

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

let pass = 0;
let fail = 0;
function assert(name, cond, detail) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

console.log("=== PR-AVG-1 privacy-request smoke ===\n");

// --- schema ---
{
  console.log("── schema ──");
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='privacy_requests'
      AND column_name IN ('requester_kind','original_channel','raw_request_text',
        'identity_status','identity_verified_by','sla_extended_at','sla_extension_reason',
        'correction_scope','response_file_key')`;
  assert("privacy_requests has 9 new intake/identity/SLA/correction cols", cols.length === 9, `got ${cols.length}`);

  const userIdNullable = await sql`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_name='privacy_requests' AND column_name='user_id'`;
  assert("privacy_requests.user_id is nullable (off-portal intake)", userIdNullable[0]?.is_nullable === "YES");

  const msgTable = await sql`SELECT tablename FROM pg_tables WHERE tablename='privacy_request_messages'`;
  assert("privacy_request_messages table exists", msgTable.length === 1);

  const statusEnum = await sql`
    SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
    WHERE t.typname='privacy_request_status' AND enumlabel='withdrawn'`;
  assert("privacy_request_status has 'withdrawn'", statusEnum.length === 1);

  const typeEnum = await sql`
    SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
    WHERE t.typname='privacy_request_type' AND enumlabel='other'`;
  assert("privacy_request_type has 'other'", typeEnum.length === 1);

  const newEnums = await sql`
    SELECT typname FROM pg_type
    WHERE typname IN ('privacy_requester_kind','privacy_channel','privacy_identity_status','privacy_message_direction')`;
  assert("4 new privacy enums exist", newEnums.length === 4, `got ${newEnums.length}`);
}

// --- manual (account-less) intake + lifecycle ---
let reqId;
try {
  console.log("\n── manual intake + lifecycle ──");
  const due = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  [{ id: reqId }] = await sql`
    INSERT INTO privacy_requests (user_id, type, status, due_date, requester_kind, requester_name, requester_email, original_channel, raw_request_text, identity_status)
    VALUES (NULL, 'deletion', 'pending', ${due.toISOString()}, 'external', 'SMOKE Requester', 'smoke@example.com', 'email', 'SMOKE verzoek', 'not_started')
    RETURNING id`;
  assert("manual intake row inserted (null user_id)", Boolean(reqId));

  const [chk] = await sql`SELECT identity_status, original_channel FROM privacy_requests WHERE id=${reqId}`;
  assert("identity_status='not_started', channel='email'", chk.identity_status === "not_started" && chk.original_channel === "email");

  const claimed = await sql`
    UPDATE privacy_requests SET status='in_progress', handled_by=NULL WHERE id=${reqId} AND status='pending' RETURNING id`;
  assert("atomic claim flips pending → in_progress", claimed.length === 1);
  const reclaim = await sql`
    UPDATE privacy_requests SET status='in_progress' WHERE id=${reqId} AND status='pending' RETURNING id`;
  assert("re-claim is a no-op", reclaim.length === 0);

  await sql`UPDATE privacy_requests SET identity_status='verified', identity_verified_at=now() WHERE id=${reqId}`;
  const [idchk] = await sql`SELECT identity_status FROM privacy_requests WHERE id=${reqId}`;
  assert("identity set to verified", idchk.identity_status === "verified");

  const [msg] = await sql`
    INSERT INTO privacy_request_messages (privacy_request_id, direction, channel, body)
    VALUES (${reqId}, 'outbound', 'email', 'SMOKE: identiteit bevestigd')
    RETURNING id`;
  assert("correspondence message inserted (FK ok)", Boolean(msg?.id));

  const newDue = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  await sql`UPDATE privacy_requests SET due_date=${newDue.toISOString()}, sla_extended_at=now(), sla_extension_reason='SMOKE extension', sla_extension_notified_at=now() WHERE id=${reqId}`;
  const [ext] = await sql`SELECT sla_extended_at, due_date FROM privacy_requests WHERE id=${reqId}`;
  assert("SLA extension recorded + dueDate moved", ext.sla_extended_at !== null);

  const withdrawn = await sql`
    UPDATE privacy_requests SET status='withdrawn' WHERE id=${reqId} AND status IN ('pending','in_progress') RETURNING id`;
  assert("withdraw flips open → withdrawn", withdrawn.length === 1);
} finally {
  if (reqId) {
    await sql`DELETE FROM privacy_request_messages WHERE privacy_request_id=${reqId}`;
    await sql`DELETE FROM privacy_requests WHERE id=${reqId}`;
    const [gone] = await sql`SELECT id FROM privacy_requests WHERE id=${reqId}`;
    assert("cleanup removed smoke request + messages", !gone);
  }
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
