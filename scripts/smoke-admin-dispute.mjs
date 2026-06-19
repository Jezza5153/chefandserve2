/**
 * Smoke — admin dispute evidence view (R2#29). Read-only.
 * 1. Source columns exist (shift_signals, shift_arrival_checks, shift_hours).
 * 2. The "arrived signal y/n" + "hours submitted y/n" derivation (mirror the page).
 * Run (dev only): node --env-file=.env.local scripts/smoke-admin-dispute.mjs
 */
import { neon } from "@neondatabase/serverless";
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";
if (!/ep-green-mouse/.test(url)) throw new Error("dev only");
const sql = neon(url);
let f = 0; const ok = (l, p) => { console.log(`${p?"✓":"✗"} ${l}`); if(!p) f++; };

const cols = await sql`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE (table_name='shift_signals' AND column_name IN ('placement_id','kind','created_at'))
     OR (table_name='shift_arrival_checks' AND column_name IN ('chef_id','status','nearby_confirmed_at'))
     OR (table_name='shift_hours' AND column_name IN ('placement_id','submitted_at','status'))`;
ok(`dispute source columns present (${cols.length}/9)`, cols.length === 9);

// arrivedSignal = arrival 'nearby' OR a chef signal of al_op_locatie/onderweg
const arrived = (arrStatus, sigKinds) => arrStatus === "nearby" || sigKinds.some((k) => k === "al_op_locatie" || k === "onderweg");
ok("arrival nearby → arrived", arrived("nearby", []) === true);
ok("chef tapped onderweg → arrived", arrived(null, ["onderweg"]) === true);
ok("chef tapped al_op_locatie → arrived", arrived("no_signal", ["al_op_locatie"]) === true);
ok("no arrival, only 'hulp' signal → not arrived", arrived(null, ["hulp"]) === false);
ok("nothing → not arrived (no accusation, just no signal)", arrived(null, []) === false);

const submitted = (submittedAt) => !!submittedAt;
ok("hours submittedAt set → clocked out", submitted("2026-06-20T23:30:00Z") === true);
ok("hours draft (no submittedAt) → not", submitted(null) === false);

console.log(f === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${f})`);
process.exit(f === 0 ? 0 : 1);
