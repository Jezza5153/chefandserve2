/**
 * Smoke — chef→klant preferences (CHEF-PR1). Read-only.
 * 1. chef_client_prefs table + enum present (mig 0068).
 * 2. chefClientPrefAdjust math (mirror matching.ts): favourite boosts, block sinks,
 *    only_emergency only penalises non-emergency, never hard-excludes (>0), clamps 100.
 * Run: node --env-file=.env.local scripts/smoke-chef-client-prefs.mjs
 */
import { neon } from "@neondatabase/serverless";
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";
if (!/ep-green-mouse/.test(url)) throw new Error("dev only");
const sql = neon(url);
let f = 0; const ok = (l, p) => { console.log(`${p?"✓":"✗"} ${l}`); if(!p) f++; };

const t = await sql`SELECT to_regclass(${"public.chef_client_prefs"}) t`;
ok("chef_client_prefs table present", t[0].t !== null);
const e = await sql`SELECT e.enumlabel v FROM pg_type ty JOIN pg_enum e ON e.enumtypid=ty.oid WHERE ty.typname='chef_client_pref' ORDER BY e.enumsortorder`;
ok("enum = favourite/block/only_emergency/only_better_brief/only_higher_rate",
  e.map(r=>r.v).join(",") === "favourite,block,only_emergency,only_better_brief,only_higher_rate");

// mirror chefClientPrefAdjust (flag assumed ON)
function adj(base, pref, isEmergency) {
  if (!pref) return base;
  switch (pref) {
    case "favourite": return Math.min(100, Math.round(base*1.1));
    case "block": return Math.round(base*0.2);
    case "only_emergency": return isEmergency ? base : Math.round(base*0.3);
    case "only_better_brief": return Math.round(base*0.7);
    case "only_higher_rate": return Math.round(base*0.7);
    default: return base;
  }
}
ok("no pref → unchanged", adj(80, undefined, false) === 80);
ok("favourite → boost (80→88)", adj(80, "favourite", false) === 88);
ok("favourite clamps at 100", adj(96, "favourite", false) === 100);
ok("block → sinks (80→16)", adj(80, "block", false) === 16);
ok("block never hard-excludes (>0)", adj(80, "block", false) > 0);
ok("only_emergency + emergency shift → unchanged", adj(80, "only_emergency", true) === 80);
ok("only_emergency + normal shift → penalised (80→24)", adj(80, "only_emergency", false) === 24);
ok("only_better_brief → soft (80→56)", adj(80, "only_better_brief", false) === 56);

console.log(f === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${f})`);
process.exit(f === 0 ? 0 : 1);
