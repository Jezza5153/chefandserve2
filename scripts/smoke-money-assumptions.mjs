/**
 * Smoke — owner-editable money assumptions (CHEF-PR8). Read-only.
 * 1. business_settings table present (KV store reused).
 * 2. getMoneyAssumptions merge logic (mirror business-settings.ts): valid numeric
 *    overrides win; invalid/negative/non-number fall back to defaults; lastUpdated/
 *    source override only when a non-empty string.
 * Run (dev only): node --env-file=.env.local scripts/smoke-money-assumptions.mjs
 */
import { neon } from "@neondatabase/serverless";
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";
if (!/ep-green-mouse/.test(url)) throw new Error("dev only");
const sql = neon(url);
let f = 0; const ok = (l, p) => { console.log(`${p?"✓":"✗"} ${l}`); if(!p) f++; };

const t = await sql`SELECT to_regclass(${"public.business_settings"}) t`;
ok("business_settings table present", t[0].t !== null);

const DEFAULT = { minimumWageHour: 14.99, vacationPct: 8, payrollEffectiveTaxPct: 25, noKortingExtraPct: 8, zzpIncomeTaxReservePct: 30, zzpZvwPct: 5.26, vatPct: 21, lastUpdated: "2026-06-15", source: "default" };
const NUM = ["minimumWageHour","vacationPct","payrollEffectiveTaxPct","noKortingExtraPct","zzpIncomeTaxReservePct","zzpZvwPct","vatPct"];
function merge(v) {
  const out = { ...DEFAULT };
  for (const k of NUM) { const n = v[k]; if (typeof n === "number" && Number.isFinite(n) && n >= 0) out[k] = n; }
  if (typeof v.lastUpdated === "string" && v.lastUpdated) out.lastUpdated = v.lastUpdated;
  if (typeof v.source === "string" && v.source) out.source = v.source;
  return out;
}
ok("no override → defaults", merge({}).vacationPct === 8 && merge({}).vatPct === 21);
ok("valid override wins", merge({ vacationPct: 8.33 }).vacationPct === 8.33);
ok("negative override ignored", merge({ vatPct: -5 }).vatPct === 21);
ok("non-number override ignored", merge({ vatPct: "twintig" }).vatPct === 21);
ok("0 is a valid override", merge({ noKortingExtraPct: 0 }).noKortingExtraPct === 0);
ok("source string overrides", merge({ source: "KHN cao 2026" }).source === "KHN cao 2026");
ok("empty source ignored", merge({ source: "" }).source === "default");

console.log(f === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${f})`);
process.exit(f === 0 ? 0 : 1);
