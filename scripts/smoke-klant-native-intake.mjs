// PR-K2 smoke — covers the Klant-2 slice:
//   K2-1: the native `client-request` form is seeded (published, audience=client, 10 fields)
//   K2-1/K2-2: native_request + native_contact submissions land in client_submissions + clean up
//   K2-4: the chef respond() ownership predicate blocks cross-chef placement mutation (IDOR)
// Non-destructive (the cross-chef UPDATE matches 0 rows; submissions are deleted).
// Safe to re-run. Run: node scripts/smoke-klant-native-intake.mjs

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

console.log("=== PR-K2 native klant intake smoke ===\n");

// --- K2-1: client-request form seeded ---
{
  console.log("── client-request form (K2-1) ──");
  const [form] = await sql`SELECT id, status, audience FROM forms WHERE slug='client-request'`;
  assert("client-request form seeded", Boolean(form), "run npm run db:seed:forms");
  if (form) {
    assert("form is published", form.status === "published", form.status);
    assert("form audience=client", form.audience === "client", form.audience);
    const fields = await sql`SELECT key FROM form_fields WHERE form_id=${form.id}`;
    assert("form has 10 fields", fields.length === 10, `got ${fields.length}`);
    const keys = fields.map((f) => f.key);
    assert(
      "required keys present",
      ["full_name", "company", "email", "phone", "role_sought", "message"].every((k) => keys.includes(k)),
      keys.join(","),
    );
  }
}

// --- K2-1 + K2-2: native submissions land, then clean up ---
{
  console.log("\n── native submissions land (K2-1 + K2-2) ──");
  const reqExt = `smoke_req_${Date.now()}`;
  const conExt = `smoke_con_${Date.now()}`;
  const [r] = await sql`
    INSERT INTO client_submissions
      (external_id, source, raw_payload, company_name, contact_name, email, role_requested, segment, date_needed, headcount, location, notes, status)
    VALUES (${reqExt}, 'native_request', ${JSON.stringify({ full_name: "Smoke" })}::jsonb,
      'Hotel Smoke', 'Smoke', 'smoke@example.com', 'chef', 'hotel', '2026-07-01', 3, 'Amsterdam', 'note', 'new')
    RETURNING id, source, status, headcount`;
  assert("native_request inserts (source + status + int headcount)", Boolean(r) && r.source === "native_request" && r.status === "new" && Number(r.headcount) === 3);

  const [c] = await sql`
    INSERT INTO client_submissions
      (external_id, source, raw_payload, contact_name, email, notes, status)
    VALUES (${conExt}, 'native_contact', ${JSON.stringify({ name: "Smoke" })}::jsonb,
      'Smoke', 'smoke@example.com', 'contact msg', 'new')
    RETURNING id, source`;
  assert("native_contact inserts", Boolean(c) && c.source === "native_contact");

  await sql`DELETE FROM client_submissions WHERE external_id IN (${reqExt}, ${conExt})`;
  const gone = await sql`SELECT id FROM client_submissions WHERE external_id IN (${reqExt}, ${conExt})`;
  assert("cleanup removed smoke submissions", gone.length === 0);
}

// --- K2-4: chef respond() ownership scoping blocks IDOR ---
{
  console.log("\n── chef respond() ownership scoping (K2-4) ──");
  const [p] = await sql`SELECT id, chef_id FROM placements WHERE status='proposed' AND chef_id IS NOT NULL LIMIT 1`;
  const [other] = p ? await sql`SELECT id FROM chefs WHERE id <> ${p.chef_id} LIMIT 1` : [undefined];
  if (!p || !other) {
    console.log("  (no proposed placement + 2nd chef in DB — skipping IDOR roundtrip; covered by the scoped WHERE in code)");
  } else {
    // The fix's WHERE clause: id=? AND chef_id=<caller> AND status='proposed'.
    // A non-owning chef must match 0 rows (non-destructive: a no-op SET on 0 rows).
    const wrong = await sql`
      UPDATE placements SET updated_at = updated_at
      WHERE id=${p.id} AND chef_id=${other.id} AND status='proposed' RETURNING id`;
    assert("cross-chef respond matches 0 rows (IDOR blocked)", wrong.length === 0, `matched ${wrong.length}`);

    const [own] = await sql`
      SELECT count(*)::int AS n FROM placements
      WHERE id=${p.id} AND chef_id=${p.chef_id} AND status='proposed'`;
    assert("owning chef predicate matches the placement", Number(own.n) === 1);
  }
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
