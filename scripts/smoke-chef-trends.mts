/**
 * KPI-2 smoke — the pure chef-trends engine. No DB queries (only fixture rows), but
 * we load .env.local so the import graph (metrics-history → db client) resolves:
 *   npx tsx scripts/smoke-chef-trends.mts
 * Pins: 8-week sparkline bucketing, noise-guarded deltas (arrow/plain/hidden), the
 * history gate, and every churn-risk branch (none/low/watch/elevated) with a fixed `today`.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { buildChefTrends } = await import("@/lib/domain/chef-trends");
type Row = Awaited<ReturnType<typeof import("@/lib/domain/metrics-history").getChefDailySeries>>[number];

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

const TODAY = new Date("2026-06-05T12:00:00Z");
function isoDaysAgo(n: number): string {
  const d = new Date(TODAY);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function row(daysAgo: number, p: Partial<Row> = {}): Row {
  return {
    id: `r${daysAgo}`,
    chefId: "c",
    snapshotDate: isoDaysAgo(daysAgo),
    hoursWorkedMinutes: 0,
    payCents: 0,
    revenueCents: 0,
    marginCents: 0,
    completedShifts: 0,
    ratingSum: 0,
    ratingCount: 0,
    proposalsAccepted: 0,
    proposalsRejected: 0,
    cancellations: 0,
    hoursSubmitted: 0,
    responseSecondsSum: 0,
    responseSecondsCount: 0,
    createdAt: TODAY,
    ...p,
  } as Row;
}

console.log("=== KPI-2 chef-trends smoke ===\n");

// 1. empty series
{
  console.log("── empty ──");
  const t = buildChefTrends([], TODAY);
  assert("hasEnoughHistory false", t.hasEnoughHistory === false);
  assert("churn none", t.churn.level === "none");
  assert("hoursSparkline all zero", t.hoursSparkline.every((v) => v === 0));
  assert("hoursDelta hidden", t.hoursDelta.mode === "hidden");
}

// 2. active, low risk + sparkline placement + arrow-down delta
{
  console.log("\n── active / low ──");
  const series = [
    row(20, { hoursWorkedMinutes: 120, completedShifts: 1 }), // week2, history anchor (>14d)
    row(10, { hoursWorkedMinutes: 600, completedShifts: 1, marginCents: 5000 }), // week1 → prev period 10h
    row(3, { hoursWorkedMinutes: 300, completedShifts: 1, marginCents: 3000 }), // week0
    row(1, { hoursWorkedMinutes: 240, completedShifts: 1, marginCents: 2000 }), // week0
  ];
  const t = buildChefTrends(series, TODAY);
  assert("hasEnoughHistory true (earliest 20d)", t.hasEnoughHistory === true);
  assert("hoursSparkline[7] = 9 (this week 5+4)", t.hoursSparkline[7] === 9, `[${t.hoursSparkline.join(",")}]`);
  assert("hoursSparkline[6] = 10 (last week)", t.hoursSparkline[6] === 10);
  assert("hoursDelta arrow + down (9 vs 10)", t.hoursDelta.mode === "arrow" && t.hoursDelta.dir === "down", `${t.hoursDelta.mode}/${t.hoursDelta.dir}`);
  assert("hoursDelta thisPeriod=9 prevPeriod=10", t.hoursDelta.thisPeriod === 9 && t.hoursDelta.prevPeriod === 10, `${t.hoursDelta.thisPeriod}/${t.hoursDelta.prevPeriod}`);
  assert("churn low (recent, no signals)", t.churn.level === "low", t.churn.level);
  assert("daysSinceLastWorked = 1", t.daysSinceLastWorked === 1, String(t.daysSinceLastWorked));
}

// 3. noise guard → plain (prev < 5)
{
  console.log("\n── noise guard / plain ──");
  const series = [
    row(20, { hoursWorkedMinutes: 60, completedShifts: 1 }),
    row(9, { hoursWorkedMinutes: 180 }), // prev period = 3h (<5 baseline)
    row(1, { hoursWorkedMinutes: 120 }), // this period = 2h
  ];
  const t = buildChefTrends(series, TODAY);
  assert("hoursDelta plain (prev 3 < 5)", t.hoursDelta.mode === "plain", `${t.hoursDelta.mode} prev=${t.hoursDelta.prevPeriod}`);
}

// 4. idle → watch (30–60d)
{
  console.log("\n── idle / watch ──");
  const t = buildChefTrends([row(40, { hoursWorkedMinutes: 300, completedShifts: 1 })], TODAY);
  assert("daysSinceLastWorked = 40", t.daysSinceLastWorked === 40, String(t.daysSinceLastWorked));
  assert("churn watch", t.churn.level === "watch", t.churn.level);
  assert("reason mentions idle days", t.churn.reasons.some((r) => r.includes("niet gewerkt")));
}

// 5. idle → elevated (>60d)
{
  console.log("\n── idle / elevated ──");
  const t = buildChefTrends([row(70, { hoursWorkedMinutes: 300, completedShifts: 1 })], TODAY);
  assert("churn elevated (70d)", t.churn.level === "elevated", t.churn.level);
}

// 6. cancellation slope → watch
{
  console.log("\n── cancellation slope / watch ──");
  const series = [
    row(20, { hoursWorkedMinutes: 120, completedShifts: 1 }),
    row(5, { cancellations: 3, hoursWorkedMinutes: 60, completedShifts: 1 }), // recent cancels, still recently active
    row(2, { hoursWorkedMinutes: 120, completedShifts: 1 }),
  ];
  const t = buildChefTrends(series, TODAY);
  assert("churn watch (cancels rising)", t.churn.level === "watch", t.churn.level);
  assert("reason mentions annuleringen", t.churn.reasons.some((r) => r.includes("annuleringen")));
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
