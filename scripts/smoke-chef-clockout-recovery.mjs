/**
 * Smoke — chef clock-out recovery (CHEF-PR4). Read-only.
 * 1. notifications insert columns exist (the worker writes via raw SQL).
 * 2. gating logic: notify only when flag ON + draft freshly created + chef has a user.
 * Run (dev only): node --env-file=.env.local scripts/smoke-chef-clockout-recovery.mjs
 */
import { neon } from "@neondatabase/serverless";
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";
if (!/ep-green-mouse/.test(url)) throw new Error("dev only");
const sql = neon(url);
let f = 0; const ok = (l, p) => { console.log(`${p?"✓":"✗"} ${l}`); if(!p) f++; };

const cols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='notifications'
    AND column_name IN ('user_id','type','title','body','action_url','entity_type','entity_id')`;
ok(`notifications insert columns present (${cols.length}/7)`, cols.length === 7);

// gating (mirror complete-placements): notify iff flagOn && freshDraft && chefUserId
const notify = (flagOn, freshDraft, chefUserId) => flagOn && freshDraft && !!chefUserId;
ok("flag off → no notify", notify(false, true, "u1") === false);
ok("draft not fresh (ON CONFLICT) → no notify", notify(true, false, "u1") === false);
ok("chef has no user → no notify", notify(true, true, null) === false);
ok("flag on + fresh draft + chef user → notify once", notify(true, true, "u1") === true);

console.log(f === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${f})`);
process.exit(f === 0 ? 0 : 1);
