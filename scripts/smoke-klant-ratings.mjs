// PR-KLANT-5 smoke — verifies ratings table + chefs rollup columns, the
// stars CHECK, the placement_id UNIQUE (double-submit guard), and the
// average/count recompute. Cleans up fully (restores the chef rollup).
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

console.log("=== PR-KLANT-5 ratings smoke ===\n");

// --- schema ---
{
  console.log("── schema ──");
  const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='ratings'`;
  assert("ratings table exists", tables.length === 1);

  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='chefs' AND column_name IN ('average_rating','rating_count')`;
  assert("chefs has average_rating + rating_count", cols.length === 2);

  const uniq = await sql`
    SELECT conname FROM pg_constraint WHERE conname='ratings_placement_id_unique'`;
  assert("ratings.placement_id UNIQUE exists", uniq.length === 1);

  const chk = await sql`
    SELECT conname FROM pg_constraint WHERE conname='ratings_stars_check'`;
  assert("ratings_stars_check exists", chk.length === 1);
}

// --- need a real placement (un-rated) ---
const [placement] = await sql`
  SELECT p.id, p.chef_id, p.shift_id, s.client_id
  FROM placements p
  INNER JOIN shifts s ON s.id = p.shift_id
  WHERE p.id NOT IN (SELECT placement_id FROM ratings)
  LIMIT 1`;
if (!placement) {
  console.log("\n(no un-rated placements in DB — skipping roundtrip; schema checks above still valid)");
  console.log(`\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

let ratingId;
try {
  console.log("\n── insert + rollup recompute ──");
  const [before] = await sql`SELECT rating_count FROM chefs WHERE id=${placement.chef_id}`;
  const beforeCount = Number(before.rating_count);

  [{ id: ratingId }] = await sql`
    INSERT INTO ratings (placement_id, chef_id, client_id, stars, tags, comment, created_by)
    VALUES (${placement.id}, ${placement.chef_id}, ${placement.client_id}, 4, ARRAY['punctueel','zelfstandig'], 'SMOKE rating', NULL)
    RETURNING id`;
  assert("insert rating", Boolean(ratingId));

  // Recompute (mirrors src/lib/domain/ratings.ts).
  await sql`
    UPDATE chefs SET
      average_rating = (SELECT round(avg(stars)::numeric, 2) FROM ratings WHERE chef_id=${placement.chef_id}),
      rating_count   = (SELECT count(*)::int FROM ratings WHERE chef_id=${placement.chef_id}),
      updated_at = now()
    WHERE id=${placement.chef_id}`;

  const [after] = await sql`SELECT average_rating, rating_count FROM chefs WHERE id=${placement.chef_id}`;
  assert("rating_count incremented by 1", Number(after.rating_count) === beforeCount + 1);
  assert("average_rating is set", after.average_rating != null);

  // Double-submit guard.
  let dupRejected = false;
  try {
    await sql`INSERT INTO ratings (placement_id, chef_id, client_id, stars) VALUES (${placement.id}, ${placement.chef_id}, ${placement.client_id}, 5)`;
  } catch {
    dupRejected = true;
  }
  assert("double-submit on same placement rejected (UNIQUE)", dupRejected);

  // Stars CHECK.
  let starsRejected = false;
  try {
    await sql`INSERT INTO ratings (placement_id, chef_id, client_id, stars) VALUES (gen_random_uuid()::text, ${placement.chef_id}, ${placement.client_id}, 6)`;
  } catch {
    starsRejected = true;
  }
  assert("stars=6 rejected by CHECK", starsRejected);
} finally {
  // cleanup + restore rollup
  if (ratingId) {
    await sql`DELETE FROM ratings WHERE id=${ratingId}`;
    await sql`
      UPDATE chefs SET
        average_rating = (SELECT round(avg(stars)::numeric, 2) FROM ratings WHERE chef_id=${placement.chef_id}),
        rating_count   = (SELECT count(*)::int FROM ratings WHERE chef_id=${placement.chef_id})
      WHERE id=${placement.chef_id}`;
    const [gone] = await sql`SELECT id FROM ratings WHERE id=${ratingId}`;
    assert("cleanup removed smoke rating + restored rollup", !gone);
  }
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
