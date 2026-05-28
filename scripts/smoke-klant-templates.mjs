// PR-KLANT-4 smoke — verifies shift_templates + exceptions schema, the
// generated-shift idempotency index, AND the critical OVERNIGHT shift math
// (17:00–01:00 → endsAt is +1 day, 8h duration, DST-safe via AT TIME ZONE).
// Creates a scoped test template, generates, asserts, and cleans up fully.
// Safe to re-run.

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

console.log("=== PR-KLANT-4 recurring-templates smoke ===\n");

// --- schema presence ---
{
  console.log("── schema ──");
  const tables = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename IN ('shift_templates','shift_template_exceptions')
    ORDER BY tablename`;
  assert("shift_templates + shift_template_exceptions exist", tables.length === 2);

  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='shifts' AND column_name IN ('source_template_id','source_template_date')`;
  assert("shifts has source_template_id + source_template_date", cols.length === 2);

  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE indexname IN ('shifts_template_date_unique','shift_templates_client_dow_role_unique','shift_template_exceptions_unique')`;
  assert("3 template indexes exist", idx.length === 3);
}

// --- need a real client ---
const [client] = await sql`SELECT id FROM clients LIMIT 1`;
if (!client) {
  console.log("\n(no clients in DB — skipping generation; schema checks above still valid)");
  console.log(`\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

// --- overnight generation roundtrip ---
let templateId;
try {
  console.log("\n── overnight generation (17:00–01:00 +1 dag) ──");
  // Friday (DOW 5) 17:00–01:00 next day, sous_chef.
  [{ id: templateId }] = await sql`
    INSERT INTO shift_templates
      (client_id, role_needed, day_of_week, starts_at_time, ends_at_time, ends_next_day, headcount, generate_horizon_days, notes)
    VALUES (${client.id}, 'sous_chef', 5, '17:00', '01:00', true, 1, 28, 'SMOKE template')
    RETURNING id`;
  assert("insert overnight template", Boolean(templateId));

  // Generate (mirrors workers/generate-recurring-shifts.ts, scoped to this template).
  const gen = async () => sql`
    INSERT INTO shifts (
      id, client_id, starts_at, ends_at, role_needed, headcount, status,
      source_template_id, source_template_date, created_at, updated_at
    )
    SELECT
      gen_random_uuid()::text, ${client.id},
      ((g.d::date + '17:00'::time) AT TIME ZONE 'Europe/Amsterdam'),
      ((g.d::date + 1 + '01:00'::time) AT TIME ZONE 'Europe/Amsterdam'),
      'sous_chef', 1, 'open', ${templateId}, g.d::date, now(), now()
    FROM generate_series(CURRENT_DATE::timestamp, (CURRENT_DATE + 28)::timestamp, interval '1 day') AS g(d)
    WHERE EXTRACT(DOW FROM g.d) = 5
      AND g.d::date NOT IN (SELECT date FROM shift_template_exceptions WHERE template_id = ${templateId})
    ON CONFLICT (source_template_id, source_template_date)
      WHERE source_template_id IS NOT NULL DO NOTHING
    RETURNING id`;

  const first = await gen();
  assert("generated >=1 Friday shift in 28d horizon", first.length >= 1);

  // Overnight correctness: 8h duration, end day = start day + 1.
  const [chk] = await sql`
    SELECT
      EXTRACT(EPOCH FROM (ends_at - starts_at))/3600 AS hours,
      (ends_at AT TIME ZONE 'Europe/Amsterdam')::date - (starts_at AT TIME ZONE 'Europe/Amsterdam')::date AS day_diff
    FROM shifts WHERE source_template_id = ${templateId} LIMIT 1`;
  assert("overnight shift spans exactly 8 hours", Number(chk.hours) === 8, `got ${chk.hours}h`);
  assert("endsAt lands on the next calendar day", Number(chk.day_diff) === 1, `day_diff ${chk.day_diff}`);

  // Idempotency: re-run creates no duplicates.
  const second = await gen();
  assert("re-run generates 0 duplicates (ON CONFLICT)", second.length === 0);

  // Exception subtraction: add an exception on a generated date → a fresh
  // template horizon would skip it. Verify the SELECT excludes it.
  const [genShift] = await sql`
    SELECT source_template_date FROM shifts WHERE source_template_id = ${templateId} ORDER BY starts_at LIMIT 1`;
  await sql`
    INSERT INTO shift_template_exceptions (template_id, date, reason)
    VALUES (${templateId}, ${genShift.source_template_date}, 'SMOKE exception')`;
  const excludedCount = await sql`
    SELECT count(*)::int AS n
    FROM generate_series(CURRENT_DATE::timestamp, (CURRENT_DATE + 28)::timestamp, interval '1 day') AS g(d)
    WHERE EXTRACT(DOW FROM g.d) = 5
      AND g.d::date = ${genShift.source_template_date}
      AND g.d::date NOT IN (SELECT date FROM shift_template_exceptions WHERE template_id = ${templateId})`;
  assert("exception date is excluded from generation set", excludedCount[0].n === 0);
} finally {
  // cleanup — order matters (FKs)
  if (templateId) {
    await sql`DELETE FROM shifts WHERE source_template_id = ${templateId}`;
    await sql`DELETE FROM shift_template_exceptions WHERE template_id = ${templateId}`;
    await sql`DELETE FROM shift_templates WHERE id = ${templateId}`;
    const leftover = await sql`SELECT id FROM shifts WHERE source_template_id = ${templateId}`;
    assert("cleanup removed generated shifts + template", leftover.length === 0);
  }
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
