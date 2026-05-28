// PR-KLANT-0 smoke — verifies placement_comments visibility + length CHECK,
// client_contacts table, clients address split, against the production DB.
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

console.log("=== PR-KLANT-0 foundations smoke ===\n");

// --- schema presence ---
{
  console.log("── schema ──");
  const tables = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename IN ('placement_comments','client_contacts')
    ORDER BY tablename`;
  assert("placement_comments + client_contacts exist", tables.length === 2);

  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='clients' AND column_name IN ('shift_address','shift_arrival_notes','billing_address')`;
  assert("clients has shift_address + shift_arrival_notes + billing_address", cols.length === 3);

  const enums = await sql`
    SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
    WHERE t.typname='comment_visibility' ORDER BY enumsortorder`;
  assert(
    "comment_visibility enum = internal/client_visible/chef_visible",
    enums.map((e) => e.enumlabel).join(",") === "internal,client_visible,chef_visible",
  );
}

// --- need a real placement to attach comments to ---
const [placement] = await sql`SELECT id FROM placements LIMIT 1`;
if (!placement) {
  console.log("\n(no placements in DB — skipping comment-row tests; schema checks above still valid)");
  console.log(`\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

// --- placement_comments length CHECK ---
{
  console.log("\n── placement_comments length CHECK ──");
  let rejectedEmpty = false;
  try {
    await sql`INSERT INTO placement_comments (placement_id, author_kind, visibility, body)
              VALUES (${placement.id}, 'system', 'internal', '')`;
  } catch {
    rejectedEmpty = true;
  }
  assert("empty body rejected by CHECK", rejectedEmpty);

  let rejectedLong = false;
  const huge = "x".repeat(1001);
  try {
    await sql`INSERT INTO placement_comments (placement_id, author_kind, visibility, body)
              VALUES (${placement.id}, 'system', 'internal', ${huge})`;
  } catch {
    rejectedLong = true;
  }
  assert("1001-char body rejected by CHECK", rejectedLong);
}

// --- visibility filtering ---
{
  console.log("\n── visibility filtering ──");
  // Insert one of each visibility
  await sql`INSERT INTO placement_comments (placement_id, author_kind, visibility, body)
            VALUES (${placement.id}, 'admin', 'internal', 'SMOKE internal note')`;
  await sql`INSERT INTO placement_comments (placement_id, author_kind, visibility, body)
            VALUES (${placement.id}, 'client', 'client_visible', 'SMOKE client comment')`;
  await sql`INSERT INTO placement_comments (placement_id, author_kind, visibility, body)
            VALUES (${placement.id}, 'admin', 'chef_visible', 'SMOKE chef note')`;

  const clientScope = await sql`
    SELECT visibility FROM placement_comments
    WHERE placement_id=${placement.id} AND body LIKE 'SMOKE%' AND visibility IN ('client_visible')`;
  assert("client scope sees ONLY client_visible", clientScope.length === 1 && clientScope[0].visibility === "client_visible");

  const chefScope = await sql`
    SELECT visibility FROM placement_comments
    WHERE placement_id=${placement.id} AND body LIKE 'SMOKE%' AND visibility IN ('chef_visible')`;
  assert("chef scope sees ONLY chef_visible", chefScope.length === 1 && chefScope[0].visibility === "chef_visible");

  const adminScope = await sql`
    SELECT visibility FROM placement_comments
    WHERE placement_id=${placement.id} AND body LIKE 'SMOKE%'
      AND visibility IN ('internal','client_visible','chef_visible')`;
  assert("admin scope sees ALL three", adminScope.length === 3);

  // cleanup
  await sql`DELETE FROM placement_comments WHERE placement_id=${placement.id} AND body LIKE 'SMOKE%'`;
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
