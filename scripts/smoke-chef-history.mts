/**
 * PR-1.6 smoke — Chef 360 read model against the real DB. Run with tsx:
 *   npx tsx scripts/smoke-chef-history.mts
 * Proves the HARDENING rule: totalHoursWorked counts ONLY final (admin_approved/
 * exported) shift_hours — never draft. Plus completed/upcoming/rating/feedback/
 * client-history. Seeds a throwaway chef + client + shifts; self-cleaning.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!);
const h = await import("@/lib/domain/chef-history");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

const ts = Date.now();
const uuid = () => crypto.randomUUID();
const chefId = uuid();
const clientId = uuid();
const pastShift = uuid();
const futureShift = uuid();
const pPast = uuid();
const pFuture = uuid();
const TAG = `op_tijd`;

console.log("=== PR-1.6 Chef 360 smoke ===\n");

try {
  await sql`INSERT INTO chefs (id, full_name, status) VALUES (${chefId}, ${`SMOKE Hist Chef ${ts}`}, 'active')`;
  await sql`INSERT INTO clients (id, company_name, status) VALUES (${clientId}, ${`SMOKE Hist Hotel ${ts}`}, 'active')`;
  // past (completed) + future (confirmed) shift
  await sql`INSERT INTO shifts (id, client_id, starts_at, ends_at, role_needed, segment, status) VALUES
    (${pastShift}, ${clientId}, now() - interval '10 days', now() - interval '10 days' + interval '5 hours', 'chef_de_partie', 'hotel', 'completed'),
    (${futureShift}, ${clientId}, now() + interval '5 days', now() + interval '5 days' + interval '5 hours', 'chef_de_partie', 'hotel', 'filled')`;
  await sql`INSERT INTO placements (id, shift_id, chef_id, status) VALUES
    (${pPast}, ${pastShift}, ${chefId}, 'completed'),
    (${pFuture}, ${futureShift}, ${chefId}, 'confirmed')`;
  // hours: 1 admin_approved (300 min = 5h, COUNTS) + 1 draft (600 min, MUST NOT count)
  await sql`INSERT INTO shift_hours (placement_id, shift_id, chef_id, client_id, started_at, ended_at, break_minutes, worked_minutes, chef_rate_cents, client_rate_cents, status) VALUES
    (${pPast}, ${pastShift}, ${chefId}, ${clientId}, now() - interval '10 days', now() - interval '10 days' + interval '5 hours', 0, 300, 2500, 4500, 'admin_approved'),
    (${pFuture}, ${futureShift}, ${chefId}, ${clientId}, now() + interval '5 days', now() + interval '5 days' + interval '5 hours', 0, 600, 2500, 4500, 'draft')`;
  await sql`INSERT INTO ratings (placement_id, chef_id, client_id, stars, tags, comment) VALUES
    (${pPast}, ${chefId}, ${clientId}, 5, ${`{${TAG}}`}, ${`SMOKE: zelfstandig en op tijd`})`;
  assert("seed complete", true);

  console.log("\n── getChefWorkSummary ──");
  const sum = await h.getChefWorkSummary(chefId);
  assert("hours = 5 (only admin_approved 300m; draft 600m excluded)", sum.totalHoursWorked === 5, `got ${sum.totalHoursWorked}`);
  assert("completedShifts = 1", sum.completedShifts === 1, String(sum.completedShifts));
  assert("upcomingShifts = 1", sum.upcomingShifts === 1, String(sum.upcomingShifts));
  assert("averageRating = 5", sum.averageRating === 5, String(sum.averageRating));
  assert("ratingCount = 1", sum.ratingCount === 1);
  assert("lastWorkedAt set", sum.lastWorkedAt !== null);
  assert("topClients includes the hotel", sum.topClients.some((c) => c.name.includes("SMOKE Hist Hotel")));
  assert("topSegments includes hotel", sum.topSegments.some((s) => s.segment === "hotel"));

  console.log("\n── getChefFeedbackSummary ──");
  const fb = await h.getChefFeedbackSummary(chefId);
  assert("1 recent feedback", fb.recent.length === 1);
  assert("feedback has comment + stars", fb.recent[0].stars === 5 && Boolean(fb.recent[0].comment));
  assert("topTags includes seeded tag", fb.topTags.some((t) => t.tag === TAG));

  console.log("\n── getChefClientHistory ──");
  const ch = await h.getChefClientHistory(chefId, clientId);
  assert("completedShifts for client = 1", ch.completedShifts === 1, String(ch.completedShifts));
  assert("avg rating for client = 5", ch.averageRatingForClient === 5);
  assert("isFavorite/isBlocked false (pre-PR-2B)", ch.isFavorite === false && ch.isBlocked === false);
} finally {
  console.log("\n── cleanup ──");
  await sql`DELETE FROM ratings WHERE chef_id=${chefId}`;
  await sql`DELETE FROM shift_hours WHERE chef_id=${chefId}`;
  await sql`DELETE FROM placements WHERE chef_id=${chefId}`;
  await sql`DELETE FROM shifts WHERE id IN (${pastShift}, ${futureShift})`;
  await sql`DELETE FROM clients WHERE id=${clientId}`;
  await sql`DELETE FROM chefs WHERE id=${chefId}`;
  const [gone] = await sql`SELECT id FROM chefs WHERE id=${chefId}`;
  assert("cleanup removed smoke rows", !gone);
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
