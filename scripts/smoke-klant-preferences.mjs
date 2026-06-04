// PR-K2-5 smoke — klant venue preferences. The clients.client_type +
// client_tags columns (PR-2B, already feeding matching) accept the shared
// client-taxonomy values the new /client/profile "Voorkeuren" section writes.
// Uses a throwaway client (created + deleted) so it's fully non-destructive.
// Safe to re-run. Run: node scripts/smoke-klant-preferences.mjs

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

console.log("=== PR-K2-5 klant preferences smoke ===\n");

const cols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='clients' AND column_name IN ('client_type','client_tags')`;
assert("clients has client_type + client_tags columns", cols.length === 2, `got ${cols.length}`);

const marker = `smoke_pref_${Date.now()}`;
let id;
try {
  // clients.id has a Drizzle ($defaultFn) default, NOT a DB default — supply one.
  [{ id }] = await sql`
    INSERT INTO clients (id, company_name, status, client_type, client_tags)
    VALUES (gen_random_uuid()::text, ${marker}, 'prospect', 'hotel', ARRAY['ontbijt','fine_dining'])
    RETURNING id`;
  const [r] = await sql`SELECT client_type, client_tags FROM clients WHERE id=${id}`;
  assert("client_type persists ('hotel')", r.client_type === "hotel", r.client_type);
  assert(
    "client_tags persists (2 taxonomy values)",
    Array.isArray(r.client_tags) &&
      r.client_tags.length === 2 &&
      r.client_tags.includes("ontbijt") &&
      r.client_tags.includes("fine_dining"),
    JSON.stringify(r.client_tags),
  );
} finally {
  if (id) {
    await sql`DELETE FROM clients WHERE id=${id}`;
    const gone = await sql`SELECT id FROM clients WHERE id=${id}`;
    assert("cleanup removed throwaway client", gone.length === 0);
  }
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
