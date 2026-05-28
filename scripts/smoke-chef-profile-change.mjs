// PR-CHEF-4 admin-review smoke — verifies the profile_change_requests
// lifecycle the admin chef-detail page drives: insert pending → atomic
// approve (flip only a still-pending row) → re-approve is a no-op. Does NOT
// mutate real chef columns (the apply step is type-checked Drizzle). Cleans
// up after itself. Safe to re-run.

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

console.log("=== PR-CHEF-4 admin-review smoke ===\n");

{
  console.log("── schema ──");
  const tables = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename='profile_change_requests'`;
  assert("profile_change_requests table exists", tables.length === 1);

  const enums = await sql`
    SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
    WHERE t.typname='profile_change_status' ORDER BY enumsortorder`;
  assert(
    "profile_change_status = pending/approved/rejected",
    enums.map((e) => e.enumlabel).join(",") === "pending,approved,rejected",
  );
}

const [chef] = await sql`SELECT id FROM chefs LIMIT 1`;
if (!chef) {
  console.log("\n(no chefs in DB — skipping lifecycle; schema checks above still valid)");
  console.log(`\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

let reqId;
try {
  console.log("\n── request lifecycle (atomic flip) ──");
  [{ id: reqId }] = await sql`
    INSERT INTO profile_change_requests (chef_id, field, current_value, proposed_value, reason, status)
    VALUES (${chef.id}, 'hourlyRate', '{"min":4000,"max":6000}'::jsonb, '{"min":4500,"max":6500}'::jsonb, 'SMOKE request', 'pending')
    RETURNING id`;
  assert("insert pending request", Boolean(reqId));

  const approved = await sql`
    UPDATE profile_change_requests SET status='approved', decided_at=now()
    WHERE id=${reqId} AND status='pending' RETURNING id`;
  assert("atomic approve flips pending → approved", approved.length === 1);

  const reApprove = await sql`
    UPDATE profile_change_requests SET status='approved'
    WHERE id=${reqId} AND status='pending' RETURNING id`;
  assert("re-approve is a no-op (already decided)", reApprove.length === 0);

  const [readBack] = await sql`
    SELECT field, proposed_value FROM profile_change_requests WHERE id=${reqId}`;
  assert(
    "reads back hourlyRate proposed {min,max}",
    readBack.field === "hourlyRate" &&
      readBack.proposed_value.min === 4500 &&
      readBack.proposed_value.max === 6500,
  );
} finally {
  if (reqId) {
    await sql`DELETE FROM profile_change_requests WHERE id=${reqId}`;
    const [gone] = await sql`SELECT id FROM profile_change_requests WHERE id=${reqId}`;
    assert("cleanup removed smoke request", !gone);
  }
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
