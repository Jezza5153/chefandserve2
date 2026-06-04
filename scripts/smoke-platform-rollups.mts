/**
 * KPI-5 smoke — getPlatformRollups + getForecast. Run against a Neon clone:
 *   DATABASE_URL_UNPOOLED='<clone>' npx tsx scripts/smoke-platform-rollups.mts
 *
 * These read-models are platform-wide (no entity filter), so we TRUNCATE shifts +
 * the metrics tables on the throwaway clone first for clean isolation, then seed a
 * precise fixture. Proves money windows (week/month/ytd, FINAL only), realized fill
 * by role, the SURFACED capacity estimate, the 48h understaffing projection, and the
 * idle-chef churn count.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const DB = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!;
const { neon } = await import("@neondatabase/serverless");
const sql = neon(DB);
const roll = await import("@/lib/domain/platform-rollups");
const fc = await import("@/lib/domain/forecast");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

const uuid = () => crypto.randomUUID();
const ts = Date.now();
const A = uuid(); const B = uuid(); const C = uuid(); const D = uuid();
const K = uuid();
const R1 = uuid(); const R2 = uuid(); const F1 = uuid(); const F2 = uuid();

console.log("=== KPI-5 platform-rollups + forecast smoke ===\n");

console.log("── isolate (truncate shifts + metrics on the throwaway clone) ──");
await sql`TRUNCATE TABLE shifts, chef_metrics_daily, client_metrics_daily CASCADE`;
assert("clone isolated", true);

console.log("\n── seed ──");
await sql`INSERT INTO chefs (id, full_name, status) VALUES
  (${A}, ${`SMOKE PR A ${ts}`}, 'active'), (${B}, ${`SMOKE PR B ${ts}`}, 'active'),
  (${C}, ${`SMOKE PR C ${ts}`}, 'active'), (${D}, ${`SMOKE PR D ${ts}`}, 'active')`;
await sql`INSERT INTO clients (id, company_name, status) VALUES (${K}, ${`SMOKE PR Hotel ${ts}`}, 'active')`;
// money: A across week/month/ytd buckets · D idle (churn)
await sql`INSERT INTO chef_metrics_daily
    (chef_id, snapshot_date, revenue_cents, pay_cents, margin_cents, hours_worked_minutes, completed_shifts) VALUES
  (${A}, (now()-interval '3 days')::date,  60000, 40000, 20000, 300, 1),
  (${A}, (now()-interval '20 days')::date, 30000, 20000, 10000, 240, 1),
  (${A}, (now()-interval '45 days')::date, 15000, 10000,  5000, 120, 1),
  (${D}, (now()-interval '60 days')::date,     0,     0,     0, 300, 1)`;
// realized shifts (fill) + future shifts (forecast)
await sql`INSERT INTO shifts (id, client_id, starts_at, ends_at, role_needed, segment, status, headcount) VALUES
  (${R1}, ${K}, now()-interval '5 days',  now()-interval '5 days' +interval '5h', 'chef_de_partie', 'hotel', 'completed', 2),
  (${R2}, ${K}, now()-interval '10 days', now()-interval '10 days'+interval '5h', 'bediening',      'hotel', 'completed', 2),
  (${F1}, ${K}, now()+interval '1 day',   now()+interval '1 day'  +interval '5h', 'chef_de_partie', 'hotel', 'open', 3),
  (${F2}, ${K}, now()+interval '36 hours',now()+interval '36 hours'+interval '5h','bediening',      'hotel', 'open', 1)`;
await sql`INSERT INTO placements (id, shift_id, chef_id, status) VALUES
  (${uuid()}, ${R1}, ${A}, 'completed'), (${uuid()}, ${R1}, ${B}, 'completed'),
  (${uuid()}, ${R2}, ${C}, 'completed'),
  (${uuid()}, ${F1}, ${A}, 'confirmed')`;
assert("seed complete", true);

console.log("\n── getPlatformRollups ──");
const r = await roll.getPlatformRollups();
assert("week revenue 60000 / margin 20000", r.week.revenueCents === 60000 && r.week.marginCents === 20000, `${r.week.revenueCents}/${r.week.marginCents}`);
assert("month margin 30000", r.month.marginCents === 30000, String(r.month.marginCents));
assert("ytd margin 35000", r.ytd.marginCents === 35000, String(r.ytd.marginCents));
assert("overallFill 3/4 (0.75)", r.overallFill.filled === 3 && r.overallFill.slots === 4, `${r.overallFill.filled}/${r.overallFill.slots}`);
const cdp = r.fillByRole.find((x) => x.key === "chef_de_partie");
const bed = r.fillByRole.find((x) => x.key === "bediening");
assert("fillByRole chef_de_partie 2/2", cdp?.filled === 2 && cdp?.slots === 2, JSON.stringify(cdp));
assert("fillByRole bediening 1/2", bed?.filled === 1 && bed?.slots === 2, JSON.stringify(bed));
assert("activeChefs 1, workedHours 9", r.activeChefs === 1 && r.workedHours === 9, `${r.activeChefs}/${r.workedHours}`);
assert("capacity util = 7% (surfaced estimate)", r.capacity.utilizationPct === 7, String(r.capacity.utilizationPct));

console.log("\n── getForecast ──");
const f = await fc.getForecast();
assert("totalOpenSlots 3 (F1:2 + F2:1)", f.totalOpenSlots === 3, String(f.totalOpenSlots));
const ucdp = f.understaffingByRole.find((x) => x.role === "chef_de_partie");
assert("understaffing chef_de_partie = 2", ucdp?.needed === 2, JSON.stringify(f.understaffingByRole));
assert("churnRiskCount 1 (D idle 60d)", f.churnRiskCount === 1, String(f.churnRiskCount));
assert("forecastEnabled false by default", fc.forecastEnabled() === false);

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓ (throwaway clone — no cleanup needed)");
