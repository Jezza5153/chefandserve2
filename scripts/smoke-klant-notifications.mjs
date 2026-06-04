// PR-K2-7/K2-8 smoke — klant mail-preferences (notification_prefs) + per-form
// notification routes (notification_routes under `form:<slug>` keys). Verifies
// the DB contracts that setPref + the admin saveRoute write and that
// shouldSendToUser / recipientsForForm read. The per-form route is a throwaway
// key (no FK), fully cleaned up. Safe to re-run.

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

console.log("=== PR-K2-7/8 klant notifications smoke ===\n");

// --- notification_prefs (K2-7) — schema; the read/write logic is type-checked in prefs.ts ---
{
  console.log("── notification_prefs (K2-7) ──");
  const cols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name='notification_prefs' AND column_name IN ('user_id','prefs')`;
  assert("notification_prefs has user_id + prefs", cols.length === 2, `got ${cols.length}`);
  const prefsCol = cols.find((c) => c.column_name === "prefs");
  assert("prefs column is jsonb", prefsCol?.data_type === "jsonb", prefsCol?.data_type);
}

// --- per-form notification route (K2-8) — full round-trip on a throwaway key ---
{
  console.log("\n── per-form route (K2-8) ──");
  const key = "form:_smoke_test";
  try {
    await sql`
      INSERT INTO notification_routes (event, recipients, enabled)
      VALUES (${key}, ARRAY['smoke@example.com']::text[], true)
      ON CONFLICT (event) DO UPDATE SET recipients=ARRAY['smoke@example.com']::text[], enabled=true`;
    const [r] = await sql`SELECT recipients, enabled FROM notification_routes WHERE event=${key}`;
    assert(
      "form route stored (recipients + enabled) → recipientsForForm override",
      Boolean(r) &&
        r.enabled === true &&
        Array.isArray(r.recipients) &&
        r.recipients.includes("smoke@example.com"),
      JSON.stringify(r),
    );
  } finally {
    await sql`DELETE FROM notification_routes WHERE event=${key}`;
    const gone = await sql`SELECT event FROM notification_routes WHERE event=${key}`;
    assert("cleanup removed throwaway form route", gone.length === 0);
  }
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
