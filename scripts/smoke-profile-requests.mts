/**
 * PR-2.1 smoke — missing-data request workflow against the real DB. Run with tsx:
 *   npx tsx scripts/smoke-profile-requests.mts
 * Creates a request (whatsapp channel → no real email), asserts the row +
 * contact_logs link, then closes the loop via markCompletedByEmail. Self-cleaning.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!);
const m = await import("@/lib/domain/profile-data-requests");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

const ts = Date.now();
const uuid = () => crypto.randomUUID();
const actorId = uuid();
const chefId = uuid();
const email = `smoke-pdr-${ts}@example.com`;

console.log("=== PR-2.1 missing-data request smoke ===\n");

try {
  await sql`INSERT INTO users (id, email, name, kind, status) VALUES (${actorId}, ${`smoke-actor-${ts}@example.com`}, 'SMOKE Actor', 'internal', 'active')`;
  await sql`INSERT INTO chefs (id, full_name, email, phone, status) VALUES (${chefId}, ${`SMOKE PDR Chef ${ts}`}, ${email}, '0600000009', 'active')`;
  assert("seed chef + actor", true);

  const res = await m.createProfileDataRequest({
    chefId,
    requestedFields: ["postcode", "vervoer", "voorkeuren"],
    channel: "whatsapp", // no real email sent
    createdBy: actorId,
  });
  assert("createProfileDataRequest ok", res.ok === true, res.error);

  const [row] = await sql`SELECT request_type, channel, status, requested_fields, contact_log_id FROM profile_data_requests WHERE chef_id=${chefId}` as { request_type: string; channel: string; status: string; requested_fields: string[]; contact_log_id: string | null }[];
  assert("request row stored", Boolean(row));
  assert("channel=whatsapp · status=sent", row.channel === "whatsapp" && row.status === "sent", `${row.channel}/${row.status}`);
  assert("requested_fields captured", row.requested_fields.includes("postcode") && row.requested_fields.includes("vervoer"));
  assert("linked to a contact_logs row", Boolean(row.contact_log_id));

  const [cl] = await sql`SELECT outcome, entity_type FROM contact_logs WHERE target_id=${chefId} AND target_type='chef'` as { outcome: string; entity_type: string }[];
  assert("contact_logs row written (entity=profile_data_request)", cl?.entity_type === "profile_data_request");

  const listed = await m.listProfileDataRequests(chefId);
  assert("listProfileDataRequests returns it", listed.length === 1);

  const completed = await m.markCompletedByEmail(email, "smoke-jotform-1");
  assert("markCompletedByEmail closed 1 request", completed === 1, String(completed));
  const [after] = await sql`SELECT status, completed_at, jotform_submission_id FROM profile_data_requests WHERE chef_id=${chefId}` as { status: string; completed_at: string | null; jotform_submission_id: string | null }[];
  assert("status → completed + completed_at + jotform id", after.status === "completed" && after.completed_at !== null && after.jotform_submission_id === "smoke-jotform-1");
} finally {
  console.log("\n── cleanup ──");
  await sql`DELETE FROM profile_data_requests WHERE chef_id=${chefId}`;
  await sql`DELETE FROM contact_logs WHERE target_id=${chefId} AND target_type='chef'`;
  await sql`DELETE FROM audit_log WHERE user_id=${actorId}`;
  await sql`DELETE FROM email_messages WHERE to_email=${email}`;
  await sql`DELETE FROM chefs WHERE id=${chefId}`;
  await sql`DELETE FROM users WHERE id=${actorId}`;
  const [gone] = await sql`SELECT id FROM chefs WHERE id=${chefId}`;
  assert("cleanup removed smoke rows", !gone);
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
