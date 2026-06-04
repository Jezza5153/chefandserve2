/**
 * KPI-4 smoke — getLeaderboards over the snapshot tables. Run against a Neon clone:
 *   DATABASE_URL_UNPOOLED='<clone>' npx tsx scripts/smoke-leaderboards.mts
 *
 * Proves the rankings AND the honesty gates: a chef with only 4 ratings is excluded
 * from "highest rated"; a chef with only 3 proposals is excluded from "most reliable".
 * Also asserts the supporting date indexes exist (the boards are index-scannable at
 * scale; small seeded data won't trigger an index scan, so EXPLAIN is logged, not
 * asserted). Seeds snapshot rows directly; self-cleaning.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const DB = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!;
const { neon } = await import("@neondatabase/serverless");
const sql = neon(DB);
const h = await import("@/lib/domain/leaderboards");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

const uuid = () => crypto.randomUUID();
const ts = Date.now();
const A = uuid(); const B = uuid(); const C = uuid();
const K1 = uuid(); const K2 = uuid();

console.log("=== KPI-4 leaderboards smoke ===\n");

try {
  console.log("── seed ──");
  await sql`INSERT INTO chefs (id, full_name, status) VALUES
    (${A}, ${`SMOKE LB A ${ts}`}, 'active'),
    (${B}, ${`SMOKE LB B ${ts}`}, 'active'),
    (${C}, ${`SMOKE LB C ${ts}`}, 'active')`;
  await sql`INSERT INTO clients (id, company_name, status) VALUES
    (${K1}, ${`SMOKE LB K1 ${ts}`}, 'active'),
    (${K2}, ${`SMOKE LB K2 ${ts}`}, 'active')`;
  // one snapshot row per chef, dated within the 90d window.
  //  A: pay 30000, 5 shifts, accept 9/10 (90%), rating 24/5 = 4.8
  //  B: pay 50000 (top earner), 3 shifts, accept 6/10 (60%), rating 18/4 (count 4 → EXCLUDED from rated)
  //  C: pay 10000, 8 shifts (busiest), accept 2/3 (total 3 → EXCLUDED from reliable), rating 30/6 = 5.0
  await sql`INSERT INTO chef_metrics_daily
      (chef_id, snapshot_date, pay_cents, completed_shifts, rating_sum, rating_count, proposals_accepted, proposals_rejected) VALUES
    (${A}, (now() - interval '10 days')::date, 30000, 5, 24, 5, 9, 1),
    (${B}, (now() - interval '10 days')::date, 50000, 3, 18, 4, 6, 4),
    (${C}, (now() - interval '10 days')::date, 10000, 8, 30, 6, 2, 1)`;
  await sql`INSERT INTO client_metrics_daily (client_id, snapshot_date, spend_cents) VALUES
    (${K1}, (now() - interval '10 days')::date, 80000),
    (${K2}, (now() - interval '10 days')::date, 40000)`;
  assert("seed complete", true);

  console.log("\n── getLeaderboards ──");
  const lb = await h.getLeaderboards(90, 5);
  // limit to our seeded ids so a shared clone with other data can't break asserts
  const mine = new Set([A, B, C]);
  const earners = lb.topEarners.filter((e) => mine.has(e.id));
  const busiest = lb.busiest.filter((e) => mine.has(e.id));
  const reliable = lb.mostReliable.filter((e) => mine.has(e.id));
  const rated = lb.highestRated.filter((e) => mine.has(e.id));
  const clientsLb = lb.topClients.filter((e) => e.id === K1 || e.id === K2);

  assert("topEarners order B>A>C", earners.map((e) => e.id).join() === [B, A, C].join(), earners.map((e) => e.display).join());
  assert("busiest top = C (8)", busiest[0]?.id === C && busiest[0]?.display === "8 diensten", busiest[0]?.display);
  assert("mostReliable top = A (90%)", reliable[0]?.id === A && reliable[0]?.display === "90%", reliable[0]?.display);
  assert("mostReliable EXCLUDES C (3 proposals < 5)", !reliable.some((e) => e.id === C));
  assert("mostReliable sub shows base", reliable[0]?.sub === "9/10 geaccepteerd", reliable[0]?.sub);
  assert("highestRated top = C (5,0★)", rated[0]?.id === C, rated[0]?.display);
  assert("highestRated EXCLUDES B (4 ratings < 5)", !rated.some((e) => e.id === B));
  assert("highestRated A present (5 ratings, 4,8★)", rated.some((e) => e.id === A && e.display === "4,8★"), JSON.stringify(rated));
  assert("topClients order K1>K2", clientsLb.map((e) => e.id).join() === [K1, K2].join());

  console.log("\n── supporting indexes ──");
  const idx = await sql`SELECT indexname FROM pg_indexes WHERE indexname IN ('chef_metrics_daily_date_idx','client_metrics_daily_date_idx')`;
  assert("both date indexes exist", idx.length === 2, `got ${idx.length}`);
  const plan = await sql`EXPLAIN SELECT chef_id, sum(pay_cents) FROM chef_metrics_daily WHERE snapshot_date >= (now()-interval '90 days')::date GROUP BY chef_id`;
  console.log("  · EXPLAIN (informational):", (plan[0] as Record<string, string>)["QUERY PLAN"]);
} finally {
  console.log("\n── cleanup ──");
  await sql`DELETE FROM chef_metrics_daily WHERE chef_id IN (${A}, ${B}, ${C})`;
  await sql`DELETE FROM client_metrics_daily WHERE client_id IN (${K1}, ${K2})`;
  await sql`DELETE FROM chefs WHERE id IN (${A}, ${B}, ${C})`;
  await sql`DELETE FROM clients WHERE id IN (${K1}, ${K2})`;
  const [gone] = await sql`SELECT id FROM chefs WHERE id=${A}`;
  assert("cleanup removed smoke rows", !gone);
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
