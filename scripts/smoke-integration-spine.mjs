// PR-CHEF-0 smoke test — verifies the integration-spine schema + helpers
// against the production DB.
//
// Tests:
//   1. Outbox dedup: enqueue twice with same idempotency key → 1 row
//   2. Outbox claim: pending row can be claimed and marked sent
//   3. Notifications: create + getUnreadCount + markRead
//   4. Email message recording: insert + status update from webhook event
//   5. External ref upsert: insert + reverse lookup
//   6. Health summary: returns shape with expected counts
//
// Cleans up after itself. Safe to run repeatedly.

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

console.log("=== PR-CHEF-0 integration spine smoke ===\n");

// Pick a real user to attach notifications/email-messages to.
const [target] = await sql`
  SELECT id, email FROM users WHERE kind='internal' AND status='active' LIMIT 1
`;
if (!target) {
  console.error("No active internal user — cannot run smoke. Seed first.");
  process.exit(1);
}
console.log("Test user:", target.email, `(${target.id.slice(0, 8)}…)\n`);

// --- 1. Outbox dedup ----------------------------------------------------
{
  console.log("── Test 1: outbox idempotency ──");
  const key = `smoke.outbox.dedup:${Date.now()}`;

  const first = await sql`
    INSERT INTO integration_outbox
      (provider, event_type, entity_type, entity_id, payload_json, idempotency_key)
    VALUES ('smoke', 'test.dedup', 'smoke', ${target.id}, '{}'::jsonb, ${key})
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  `;
  assert("First insert returns 1 row", first.length === 1);

  const second = await sql`
    INSERT INTO integration_outbox
      (provider, event_type, entity_type, entity_id, payload_json, idempotency_key)
    VALUES ('smoke', 'test.dedup', 'smoke', ${target.id}, '{}'::jsonb, ${key})
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  `;
  assert("Second insert returns 0 rows (deduped)", second.length === 0);

  // Cleanup
  await sql`DELETE FROM integration_outbox WHERE idempotency_key = ${key}`;
}

// --- 2. Outbox claim ----------------------------------------------------
{
  console.log("\n── Test 2: outbox claim / mark sent ──");
  const key = `smoke.outbox.claim:${Date.now()}`;
  const inserted = await sql`
    INSERT INTO integration_outbox
      (provider, event_type, entity_type, entity_id, payload_json, idempotency_key, next_attempt_at)
    VALUES ('smoke', 'test.claim', 'smoke', ${target.id}, '{}'::jsonb, ${key}, now() - interval '1 minute')
    RETURNING id
  `;
  assert("Claim seed row inserted", inserted.length === 1);

  const claimed = await sql`
    WITH due AS (
      SELECT id FROM integration_outbox
      WHERE provider = 'smoke' AND status = 'pending'
        AND next_attempt_at <= now()
        AND idempotency_key = ${key}
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE integration_outbox SET status = 'processing'
    FROM due
    WHERE integration_outbox.id = due.id
    RETURNING integration_outbox.id, integration_outbox.status
  `;
  assert(
    "Claim flips status to processing",
    claimed.length === 1 && claimed[0].status === "processing",
  );

  await sql`UPDATE integration_outbox SET status='sent', sent_at=now() WHERE id = ${inserted[0].id}`;
  const [after] = await sql`SELECT status FROM integration_outbox WHERE id = ${inserted[0].id}`;
  assert("Mark sent → status='sent'", after.status === "sent");

  await sql`DELETE FROM integration_outbox WHERE id = ${inserted[0].id}`;
}

// --- 3. Notifications ---------------------------------------------------
{
  console.log("\n── Test 3: notifications ──");
  const before = await sql`
    SELECT count(*)::int AS n FROM notifications
    WHERE user_id = ${target.id} AND read_at IS NULL
  `;
  const beforeCount = before[0].n;

  const ins = await sql`
    INSERT INTO notifications (user_id, type, title, body, action_url)
    VALUES (${target.id}, 'smoke_test', 'Smoke test', 'PR-CHEF-0 smoke', '/admin/business/integrations')
    RETURNING id
  `;
  assert("Insert notification", ins.length === 1);

  const after = await sql`
    SELECT count(*)::int AS n FROM notifications
    WHERE user_id = ${target.id} AND read_at IS NULL
  `;
  assert("Unread count incremented", after[0].n === beforeCount + 1);

  const marked = await sql`
    UPDATE notifications SET read_at = now()
    WHERE id = ${ins[0].id} AND user_id = ${target.id} AND read_at IS NULL
    RETURNING id
  `;
  assert("Mark read affects exactly 1 row", marked.length === 1);

  const remarked = await sql`
    UPDATE notifications SET read_at = now()
    WHERE id = ${ins[0].id} AND user_id = ${target.id} AND read_at IS NULL
    RETURNING id
  `;
  assert("Mark-read on already-read affects 0 rows", remarked.length === 0);

  // Cleanup
  await sql`DELETE FROM notifications WHERE id = ${ins[0].id}`;
}

// --- 4. Email messages + events -----------------------------------------
{
  console.log("\n── Test 4: email_messages + email_events ──");
  const fakeId = `re_smoke_${Date.now()}`;
  const ins = await sql`
    INSERT INTO email_messages
      (provider_message_id, to_email, template, event_key, status)
    VALUES (${fakeId}, ${target.email}, 'SmokeTestEmail', 'smoke.test', 'sent')
    RETURNING id
  `;
  assert("Insert email_messages row", ins.length === 1);

  await sql`
    INSERT INTO email_events (message_id, provider_event_type, payload_json)
    VALUES (${ins[0].id}, 'email.delivered', ${{ type: "email.delivered", data: { email_id: fakeId } }}::jsonb)
  `;
  await sql`UPDATE email_messages SET status='delivered', last_event_at=now() WHERE id = ${ins[0].id}`;
  const [updated] = await sql`SELECT status FROM email_messages WHERE id = ${ins[0].id}`;
  assert("Webhook upgrades status → delivered", updated.status === "delivered");

  // Verify unique constraint on provider_message_id
  let conflictDetected = false;
  try {
    await sql`
      INSERT INTO email_messages (provider_message_id, to_email, template, status)
      VALUES (${fakeId}, ${target.email}, 'SmokeTestEmail', 'sent')
    `;
  } catch (e) {
    conflictDetected = String(e).includes("duplicate") || String(e).includes("unique");
  }
  assert(
    "Duplicate provider_message_id rejected (UNIQUE constraint)",
    conflictDetected,
  );

  // Cleanup
  await sql`DELETE FROM email_events WHERE message_id = ${ins[0].id}`;
  await sql`DELETE FROM email_messages WHERE id = ${ins[0].id}`;
}

// --- 5. External refs ----------------------------------------------------
{
  console.log("\n── Test 5: external_refs ──");
  const provider = "smoke";
  const entityId = target.id;
  const externalId = `ext-${Date.now()}`;

  await sql`
    INSERT INTO external_refs (provider, entity_type, entity_id, external_id)
    VALUES (${provider}, 'user', ${entityId}, ${externalId})
    ON CONFLICT (provider, entity_type, entity_id)
    DO UPDATE SET external_id = EXCLUDED.external_id, updated_at = now()
  `;
  const [forward] = await sql`
    SELECT external_id FROM external_refs
    WHERE provider = ${provider} AND entity_type = 'user' AND entity_id = ${entityId}
  `;
  assert("Forward lookup returns externalId", forward.external_id === externalId);

  const [reverse] = await sql`
    SELECT entity_id FROM external_refs
    WHERE provider = ${provider} AND entity_type = 'user' AND external_id = ${externalId}
  `;
  assert("Reverse lookup returns entityId", reverse.entity_id === entityId);

  // Upsert with new external id
  const externalId2 = `ext-${Date.now()}-v2`;
  await sql`
    INSERT INTO external_refs (provider, entity_type, entity_id, external_id)
    VALUES (${provider}, 'user', ${entityId}, ${externalId2})
    ON CONFLICT (provider, entity_type, entity_id)
    DO UPDATE SET external_id = EXCLUDED.external_id, updated_at = now()
  `;
  const [updated] = await sql`
    SELECT external_id FROM external_refs
    WHERE provider = ${provider} AND entity_type = 'user' AND entity_id = ${entityId}
  `;
  assert("Upsert updates externalId", updated.external_id === externalId2);

  await sql`
    DELETE FROM external_refs
    WHERE provider = ${provider} AND entity_type = 'user' AND entity_id = ${entityId}
  `;
}

// --- 6. Health-summary shape --------------------------------------------
{
  console.log("\n── Test 6: health-summary query shapes ──");
  // Run the same queries getIntegrationHealth() runs.
  const outboxRows = await sql`
    SELECT status, count(*)::int AS n FROM integration_outbox GROUP BY status
  `;
  assert("Outbox group-by-status query works", Array.isArray(outboxRows));

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const emailRows = await sql`
    SELECT status, count(*)::int AS n FROM email_messages
    WHERE created_at > ${since.toISOString()} GROUP BY status
  `;
  assert("Email group-by-status query works", Array.isArray(emailRows));

  const distinctOnRows = await sql`
    SELECT DISTINCT ON (provider) provider, status, finished_at FROM integration_runs
    ORDER BY provider, finished_at DESC NULLS LAST
  `;
  assert("DISTINCT ON last-run-per-provider query works", Array.isArray(distinctOnRows));
}

console.log("\n─────────────────────────────");
console.log("  ✓ pass:", pass);
console.log("  ✗ fail:", fail);

if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
