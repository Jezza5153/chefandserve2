// End-to-end recovery-intent atomicity test against production DB.
// Creates → peeks → consumes → re-consumes (should fail) → expires (simulated).
// Delete after PR-C verification.

import { config } from "dotenv";
config({ path: ".env.local" });

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

// --- Find a real internal user to attach the test intent to ---
const [target] = await sql`SELECT id, email FROM users WHERE kind='internal' AND status='active' LIMIT 1`;
if (!target) {
  console.error("No active internal user to attach test intent to");
  process.exit(1);
}
console.log("Test target:", target.email, "(", target.id.slice(0, 8) + "…", ")");
console.log();

function tok() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

let pass = 0;
let fail = 0;
function assert(name, cond) {
  if (cond) {
    console.log("  ✓", name);
    pass++;
  } else {
    console.log("  ✗", name);
    fail++;
  }
}

// Test 1 — create + peek + consume happy path
{
  const t = tok();
  await sql`INSERT INTO recovery_intents (token, user_id, intent, expires_at)
            VALUES (${t}, ${target.id}, 'password', now() + interval '15 minutes')`;

  const peeked = await sql`SELECT user_id FROM recovery_intents
            WHERE token=${t} AND intent='password'
              AND consumed_at IS NULL AND expires_at > now()`;
  assert("Test 1 / peek finds the row", peeked.length === 1 && peeked[0].user_id === target.id);

  const consumed = await sql`UPDATE recovery_intents
            SET consumed_at = now()
            WHERE token=${t} AND intent='password'
              AND consumed_at IS NULL AND expires_at > now()
            RETURNING user_id`;
  assert("Test 1 / consume affects 1 row", consumed.length === 1);

  const reconsumed = await sql`UPDATE recovery_intents
            SET consumed_at = now()
            WHERE token=${t} AND intent='password'
              AND consumed_at IS NULL AND expires_at > now()
            RETURNING user_id`;
  assert("Test 1 / re-consume affects 0 rows (single-use)", reconsumed.length === 0);
}

// Test 2 — wrong intent rejected
{
  const t = tok();
  await sql`INSERT INTO recovery_intents (token, user_id, intent, expires_at)
            VALUES (${t}, ${target.id}, 'password', now() + interval '15 minutes')`;

  const wrong = await sql`SELECT user_id FROM recovery_intents
            WHERE token=${t} AND intent='totp'
              AND consumed_at IS NULL AND expires_at > now()`;
  assert("Test 2 / Fence 5: password token cannot be peeked as 'totp'", wrong.length === 0);

  const wrongConsume = await sql`UPDATE recovery_intents
            SET consumed_at = now()
            WHERE token=${t} AND intent='totp'
              AND consumed_at IS NULL AND expires_at > now()
            RETURNING user_id`;
  assert("Test 2 / Fence 5: password token cannot be consumed as 'totp'", wrongConsume.length === 0);

  // Clean up
  await sql`DELETE FROM recovery_intents WHERE token=${t}`;
}

// Test 3 — expired token rejected
{
  const t = tok();
  await sql`INSERT INTO recovery_intents (token, user_id, intent, expires_at)
            VALUES (${t}, ${target.id}, 'totp', now() - interval '1 minute')`;

  const expired = await sql`SELECT user_id FROM recovery_intents
            WHERE token=${t} AND intent='totp'
              AND consumed_at IS NULL AND expires_at > now()`;
  assert("Test 3 / expired token NOT peekable", expired.length === 0);

  const expiredConsume = await sql`UPDATE recovery_intents
            SET consumed_at = now()
            WHERE token=${t} AND intent='totp'
              AND consumed_at IS NULL AND expires_at > now()
            RETURNING user_id`;
  assert("Test 3 / expired token NOT consumable", expiredConsume.length === 0);

  // Clean up
  await sql`DELETE FROM recovery_intents WHERE token=${t}`;
}

// Test 4 — unknown token gracefully rejected
{
  const t = tok();
  const unknown = await sql`SELECT user_id FROM recovery_intents
            WHERE token=${t} AND intent='password'
              AND consumed_at IS NULL AND expires_at > now()`;
  assert("Test 4 / unknown token NOT peekable", unknown.length === 0);
}

console.log();
console.log("─────────────────────────────");
console.log("  ✓ pass:", pass);
console.log("  ✗ fail:", fail);

// Final cleanup — purge any leftover test rows on this user (consumed test 1)
await sql`DELETE FROM recovery_intents WHERE user_id = ${target.id} AND created_at > now() - interval '5 minutes'`;
console.log("  cleanup: removed test intents for", target.email);

if (fail > 0) process.exit(1);
