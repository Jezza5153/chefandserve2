/**
 * smoke-k3 — request→shift handoff (K3). Verifies, against the dev DB:
 *  1. migration 0056 column `client_submissions.converted_to_shift_id` exists
 *  2. the inbox "markeer opgepakt" atomic flip works: new/triaged → converted
 *     + sets convertedToShiftId, and is idempotent (re-run flips 0 rows)
 *
 * Run: npx tsx --env-file=.env.local scripts/smoke-k3.mts
 * Raw neon driver (mirrors scripts/_verify-0043.mts) — no drizzle/path-alias deps.
 * Self-cleaning: inserts a throwaway submission, asserts, deletes it.
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error("no DB url");
const sql = neon(url);

let pass = 0;
let fail = 0;
function check(ok: boolean, label: string) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`);
  }
}

// 1. Column present (migration 0056 applied to this branch).
const col = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'client_submissions' AND column_name = 'converted_to_shift_id'`;
check(col.length === 1, "migration 0056: converted_to_shift_id column exists");

// 2. Atomic flip + idempotency on a throwaway row.
const externalId = `smoke-k3-${Date.now()}`;
const fakeShiftId = crypto.randomUUID();
const inserted = await sql`
  INSERT INTO client_submissions (external_id, source, raw_payload, status)
  VALUES (${externalId}, 'client_portal', ${JSON.stringify({ smoke: true })}::jsonb, 'triaged')
  RETURNING id`;
const id = inserted[0].id as string;

try {
  const flipped = await sql`
    UPDATE client_submissions
    SET status = 'converted', converted_to_shift_id = ${fakeShiftId},
        triaged_at = now(), updated_at = now()
    WHERE id = ${id} AND status IN ('new', 'triaged')
    RETURNING id`;
  check(flipped.length === 1, "flip: triaged → converted updates exactly 1 row");

  const after = await sql`
    SELECT status, converted_to_shift_id FROM client_submissions WHERE id = ${id}`;
  check(after[0]?.status === "converted", "flip: status is now 'converted'");
  check(after[0]?.converted_to_shift_id === fakeShiftId, "flip: convertedToShiftId is linked");

  const reflip = await sql`
    UPDATE client_submissions
    SET status = 'converted', updated_at = now()
    WHERE id = ${id} AND status IN ('new', 'triaged')
    RETURNING id`;
  check(reflip.length === 0, "idempotent: re-running the flip touches 0 rows (already converted)");
} finally {
  await sql`DELETE FROM client_submissions WHERE id = ${id}`;
  console.log("  · cleaned up throwaway submission");
}

console.log(`\n=== smoke-k3: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
