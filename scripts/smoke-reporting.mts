/**
 * Reporting time-series smoke — proves getPlatformTimeSeries aggregates
 * client_metrics_daily into a continuous platform series:
 *   - sums spend/margin/slots/filled across ALL clients per bucket,
 *   - nets negative-margin (loss) weeks correctly,
 *   - gap-fills empty buckets with zeros (continuous x-axis),
 *   - 13 weekly / 12 monthly buckets, correct totals + fill rate,
 *   - a window with no data yields an all-zero series (never crashes).
 *
 *     npx tsx scripts/smoke-reporting.mts
 *
 * Far-future snapshot dates (year 2099) isolate it from real metrics. Throwaway
 * clients + rows, torn down in finally. Needs DB env (.env.local = dev branch).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { db } = await import("@/lib/db/client");
const { getPlatformTimeSeries } = await import("@/lib/domain/reporting");
const { clientMetricsDaily, clients } = await import("@/lib/db/schema");
const { eq, inArray } = await import("drizzle-orm");

const MARK = `REPORT_SMOKE_${crypto.randomUUID()}`;

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log("  ✓", name);
    pass++;
  } else {
    console.log("  ✗", name, detail ? `— ${detail}` : "");
    fail++;
  }
}

const clientIds: string[] = [];

try {
  console.log("=== reporting time-series smoke ===\n");

  const [c1] = await db.insert(clients).values({ companyName: `${MARK} A` }).returning({ id: clients.id });
  const [c2] = await db.insert(clients).values({ companyName: `${MARK} B` }).returning({ id: clients.id });
  clientIds.push(c1.id, c2.id);

  await db.insert(clientMetricsDaily).values([
    // Two clients, same mid-June week → one bucket that must SUM across clients.
    { clientId: c1.id, snapshotDate: "2099-06-10", spendCents: 10000, marginCents: 4000, slotsCount: 5, filledSlots: 4 },
    { clientId: c1.id, snapshotDate: "2099-06-11", spendCents: 20000, marginCents: 6000, slotsCount: 3, filledSlots: 3 },
    { clientId: c2.id, snapshotDate: "2099-06-12", spendCents: 5000, marginCents: 1000, slotsCount: 2, filledSlots: 2 },
    // A different week, run at a LOSS → negative margin must net through.
    { clientId: c1.id, snapshotDate: "2099-04-15", spendCents: 8000, marginCents: -2000, slotsCount: 3, filledSlots: 1 },
  ]);

  // now = 2099-06-15 → both weeks fall inside the 13-week window.
  const now = new Date(Date.UTC(2099, 5, 15));
  const wk = await getPlatformTimeSeries({ bucket: "week", now });

  assert("weekly → 13 buckets (gap-filled)", wk.points.length === 13, `len=${wk.points.length}`);
  assert("totals revenue = 43000 (multi-client, multi-week)", wk.totals.revenueCents === 43000, `=${wk.totals.revenueCents}`);
  assert("totals margin = 9000 (loss week netted)", wk.totals.marginCents === 9000, `=${wk.totals.marginCents}`);

  const nonZero = wk.points.filter((p) => p.revenueCents !== 0);
  assert("exactly 2 non-empty week buckets", nonZero.length === 2, `=${nonZero.length}`);
  const juneWeek = nonZero.find((p) => p.revenueCents === 35000);
  assert("June week sums BOTH clients (35000)", juneWeek != null, JSON.stringify(nonZero.map((p) => p.revenueCents)));
  assert("June week fill = 9/10 = 0.9", juneWeek != null && Math.abs((juneWeek.fillRate ?? 0) - 0.9) < 1e-9, `=${juneWeek?.fillRate}`);
  const lossWeek = wk.points.find((p) => p.marginCents < 0);
  assert("a loss week shows negative margin (-2000)", lossWeek?.marginCents === -2000, `=${lossWeek?.marginCents}`);

  const empty = wk.points.filter((p) => p.revenueCents === 0);
  assert("11 empty weeks, zero-filled", empty.length === 11, `=${empty.length}`);
  assert("empty buckets have null fillRate", empty.every((p) => p.fillRate === null));
  assert(
    "totals fill = 10/13",
    Math.abs((wk.totals.fillRate ?? 0) - 10 / 13) < 1e-9,
    `=${wk.totals.fillRate}`,
  );

  const mo = await getPlatformTimeSeries({ bucket: "month", now });
  assert("monthly → 12 buckets", mo.points.length === 12, `len=${mo.points.length}`);
  assert("monthly totals revenue = 43000", mo.totals.revenueCents === 43000, `=${mo.totals.revenueCents}`);
  const juneMonth = mo.points.find((p) => p.key === "2099-06-01");
  assert("June 2099 month bucket = 35000", juneMonth?.revenueCents === 35000, `=${juneMonth?.revenueCents}`);

  // A window with NO data → all-zero series, never a crash.
  const dead = await getPlatformTimeSeries({ bucket: "week", now: new Date(Date.UTC(2099, 11, 15)) });
  assert("empty window → 13 zero buckets", dead.points.length === 13 && dead.points.every((p) => p.revenueCents === 0));
  assert("empty window → totals 0 + null fill", dead.totals.revenueCents === 0 && dead.totals.fillRate === null, JSON.stringify(dead.totals));
} finally {
  if (clientIds.length) {
    await db.delete(clientMetricsDaily).where(inArray(clientMetricsDaily.clientId, clientIds));
    await db.delete(clients).where(inArray(clients.id, clientIds));
  }
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
