/**
 * KPI-3 smoke — the Klant 360 read model. Run against a Neon clone:
 *   DATABASE_URL_UNPOOLED='<clone>' npx tsx scripts/smoke-client-history.mts
 *
 * DB section proves getClientSummary's new SQL: FINAL-only money (draft + submitted
 * hours excluded), realized fill over started shifts (future open shift excluded),
 * rotation/retention, ratings given, and the submit→sign SLA + pending sign-off count.
 * Pure section pins buildClientTrends (sparkline placement + noise-guarded delta +
 * 28d fill). Seeds throwaway rows; self-cleaning; safe to re-run.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const DB = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!;
const { neon } = await import("@neondatabase/serverless");
const sql = neon(DB);
const h = await import("@/lib/domain/client-history");
type CRow = Awaited<ReturnType<typeof import("@/lib/domain/metrics-history").getClientDailySeries>>[number];

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}
const near = (a: number | null, b: number, eps = 0.02) => a != null && Math.abs(a - b) <= eps;

console.log("=== KPI-3 client-history smoke ===\n");

// ---- pure: buildClientTrends ----
{
  console.log("── buildClientTrends (pure) ──");
  const TODAY = new Date("2026-06-05T12:00:00Z");
  const iso = (n: number) => {
    const d = new Date(TODAY); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const row = (n: number, p: Partial<CRow>): CRow => ({
    id: `r${n}`, clientId: "k", snapshotDate: iso(n), shiftsCount: 0, slotsCount: 0, filledSlots: 0,
    spendCents: 0, chefPayCents: 0, marginCents: 0, ratingSum: 0, ratingCount: 0,
    approvalSlaMinutesSum: 0, approvalSlaCount: 0, createdAt: TODAY, ...p,
  } as CRow);
  const series = [
    row(20, { spendCents: 10000, slotsCount: 1, filledSlots: 1, shiftsCount: 1 }),
    row(9, { spendCents: 40000, slotsCount: 2, filledSlots: 1, shiftsCount: 1 }), // prev week
    row(3, { spendCents: 30000, slotsCount: 2, filledSlots: 2, shiftsCount: 2 }), // this week
    row(1, { spendCents: 20000, slotsCount: 1, filledSlots: 1, shiftsCount: 1 }), // this week
  ];
  const t = h.buildClientTrends(series, TODAY);
  assert("hasEnoughHistory true", t.hasEnoughHistory === true);
  assert("spendSparkline[7] = 500 (this week €)", t.spendSparkline[7] === 500, `[${t.spendSparkline.join(",")}]`);
  assert("spendDelta arrow up (500 vs 400)", t.spendDelta.mode === "arrow" && t.spendDelta.dir === "up", `${t.spendDelta.mode}/${t.spendDelta.dir}`);
  assert("fillRate28d ≈ 0.83 (5/6)", near(t.fillRate28d, 5 / 6), String(t.fillRate28d));
}

// ---- DB: getClientSummary ----
const uuid = () => crypto.randomUUID();
const ts = Date.now();
const clientId = uuid();
const chefId = uuid();
const s1 = uuid(); const s2 = uuid(); const s3 = uuid(); const s4 = uuid();
const p1 = uuid(); const p2 = uuid(); const p4 = uuid();

try {
  console.log("\n── seed ──");
  await sql`INSERT INTO chefs (id, full_name, status) VALUES (${chefId}, ${`SMOKE K360 Chef ${ts}`}, 'active')`;
  await sql`INSERT INTO clients (id, company_name, status) VALUES (${clientId}, ${`SMOKE K360 Hotel ${ts}`}, 'active')`;
  await sql`INSERT INTO shifts (id, client_id, starts_at, ends_at, role_needed, segment, status, headcount) VALUES
    (${s1}, ${clientId}, now() - interval '10 days', now() - interval '10 days' + interval '5 hours', 'chef_de_partie', 'hotel', 'completed', 1),
    (${s2}, ${clientId}, now() - interval '9 days',  now() - interval '9 days'  + interval '5 hours', 'chef_de_partie', 'hotel', 'completed', 2),
    (${s3}, ${clientId}, now() + interval '5 days',  now() + interval '5 days'  + interval '5 hours', 'chef_de_partie', 'hotel', 'open', 1),
    (${s4}, ${clientId}, now() - interval '8 days',  now() - interval '8 days'  + interval '5 hours', 'chef_de_partie', 'hotel', 'completed', 1)`;
  await sql`INSERT INTO placements (id, shift_id, chef_id, status) VALUES
    (${p1}, ${s1}, ${chefId}, 'completed'),
    (${p2}, ${s2}, ${chefId}, 'completed'),
    (${p4}, ${s4}, ${chefId}, 'completed')`;
  // H1 FINAL (signed 2h after submit) · H2 DRAFT (excluded) · H4 submitted-not-signed (pending)
  await sql`INSERT INTO shift_hours
      (placement_id, shift_id, chef_id, client_id, started_at, ended_at, break_minutes, worked_minutes,
       chef_rate_cents, client_rate_cents, status, submitted_at, client_signed_at, admin_approved_at) VALUES
    (${p1}, ${s1}, ${chefId}, ${clientId}, now() - interval '10 days', now() - interval '10 days' + interval '5 hours', 0, 300,
       4000, 6000, 'admin_approved', now() - interval '10 days' + interval '5 hours', now() - interval '10 days' + interval '7 hours', now() - interval '9 days'),
    (${p2}, ${s2}, ${chefId}, ${clientId}, now() - interval '9 days', now() - interval '9 days' + interval '5 hours', 0, 600,
       4000, 6000, 'draft', NULL, NULL, NULL),
    (${p4}, ${s4}, ${chefId}, ${clientId}, now() - interval '8 days', now() - interval '8 days' + interval '5 hours', 0, 120,
       4000, 6000, 'submitted', now() - interval '8 days' + interval '5 hours', NULL, NULL)`;
  await sql`INSERT INTO ratings (placement_id, chef_id, client_id, stars, tags) VALUES (${p1}, ${chefId}, ${clientId}, 5, '{op_tijd}')`;
  assert("seed complete", true);

  console.log("\n── getClientSummary ──");
  const s = await h.getClientSummary(clientId);
  assert("totalShifts = 4", s.totalShifts === 4, String(s.totalShifts));
  assert("completedShifts = 3", s.completedShifts === 3, String(s.completedShifts));
  assert("openShifts = 1", s.openShifts === 1, String(s.openShifts));
  assert("upcomingShifts = 1", s.upcomingShifts === 1, String(s.upcomingShifts));
  assert("realizedSlots = 4 (1+2+1; future excluded)", s.realizedSlots === 4, String(s.realizedSlots));
  assert("realizedFilled = 3", s.realizedFilled === 3, String(s.realizedFilled));
  assert("fillRate = 0.75", near(s.fillRate, 0.75), String(s.fillRate));
  assert("hours = 5 (FINAL only; draft 600m + submitted 120m excluded)", s.totalHoursWorked === 5, String(s.totalHoursWorked));
  assert("spend = 30000c", s.spendCents === 30000, String(s.spendCents));
  assert("loonCost = 20000c", s.loonCostCents === 20000, String(s.loonCostCents));
  assert("margin = 10000c", s.marginCents === 10000, String(s.marginCents));
  assert("distinctChefs = 1", s.distinctChefs === 1, String(s.distinctChefs));
  assert("repeatChefs = 1 (3 completed)", s.repeatChefs === 1, String(s.repeatChefs));
  assert("topChefs[0] count = 3", s.topChefs[0]?.count === 3, JSON.stringify(s.topChefs));
  assert("ratingsGiven = 1, avg = 5", s.ratingsGiven === 1 && s.averageRatingGiven === 5, `${s.ratingsGiven}/${s.averageRatingGiven}`);
  assert("signoffAvgHours = 2", s.signoffAvgHours === 2, String(s.signoffAvgHours));
  assert("pendingSignoff = 1 (H4 submitted, unsigned)", s.pendingSignoff === 1, String(s.pendingSignoff));
} finally {
  console.log("\n── cleanup ──");
  await sql`DELETE FROM ratings WHERE chef_id=${chefId}`;
  await sql`DELETE FROM shift_hours WHERE chef_id=${chefId}`;
  await sql`DELETE FROM placements WHERE chef_id=${chefId}`;
  await sql`DELETE FROM shifts WHERE id IN (${s1}, ${s2}, ${s3}, ${s4})`;
  await sql`DELETE FROM clients WHERE id=${clientId}`;
  await sql`DELETE FROM chefs WHERE id=${chefId}`;
  const [gone] = await sql`SELECT id FROM clients WHERE id=${clientId}`;
  assert("cleanup removed smoke rows", !gone);
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
