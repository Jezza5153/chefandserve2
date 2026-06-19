/**
 * Smoke — chef structured cancel reasons (CHEF-PR3). Read-only.
 * 1. placements.cancel_reason column present (mig 0067).
 * 2. asCancelReason validation (mirror cancellation-severity.ts) only accepts the
 *    6 keys; "verkeerde_info" (the overpromise signal) is among them.
 * Run: node --env-file=.env.local scripts/smoke-chef-cancel-reasons.mjs
 */
import { neon } from "@neondatabase/serverless";
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";
if (!/ep-green-mouse/.test(url)) throw new Error("dev only");
const sql = neon(url);
let f = 0; const ok = (l, p) => { console.log(`${p?"✓":"✗"} ${l}`); if(!p) f++; };

const col = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='placements' AND column_name='cancel_reason'`;
ok("placements.cancel_reason present", col.length === 1);

const KEYS = new Set(["ziek","familie","vervoer","dubbel","verkeerde_info","anders"]);
const asCancelReason = (raw) => KEYS.has(raw) ? raw : null;
ok("valid key accepted", asCancelReason("ziek") === "ziek");
ok("verkeerde_info accepted (overpromise signal)", asCancelReason("verkeerde_info") === "verkeerde_info");
ok("free text rejected", asCancelReason("ik had geen zin") === null);
ok("empty rejected", asCancelReason("") === null);
ok("6 reason keys", KEYS.size === 6);

console.log(f === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${f})`);
process.exit(f === 0 ? 0 : 1);
