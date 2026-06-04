/**
 * PLANNER-1 smoke — getPlannerCockpit. Run against a Neon clone:
 *   DATABASE_URL_UNPOOLED='<clone>' npx tsx scripts/smoke-planner-intel.mts
 *
 * getPlannerCockpit is platform-wide, so we TRUNCATE shifts (CASCADE → placements)
 * on the throwaway clone first, then seed a precise roster. Proves: open-slot math
 * over the 48h window (confirmed/completed count, accepted ≠ filled), the 7d radar
 * count, accepted-not-confirmed, and that match suggestions target the most urgent
 * open shift. Intake is a trivial count(status='new') — sanity-checked only.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const DB = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!;
const { neon } = await import("@neondatabase/serverless");
const sql = neon(DB);
const h = await import("@/lib/domain/planner-intel");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

const uuid = () => crypto.randomUUID();
const ts = Date.now();
const A = uuid(); const B = uuid(); const K = uuid();
const U1 = uuid(); const U2 = uuid(); const F7 = uuid();

console.log("=== PLANNER-1 planner-intel smoke ===\n");

console.log("── isolate + seed ──");
await sql`TRUNCATE TABLE shifts CASCADE`;
await sql`INSERT INTO chefs (id, full_name, status) VALUES (${A}, ${`SMOKE PL A ${ts}`}, 'active'), (${B}, ${`SMOKE PL B ${ts}`}, 'active')`;
await sql`INSERT INTO clients (id, company_name, status) VALUES (${K}, ${`SMOKE PL Hotel ${ts}`}, 'active')`;
await sql`INSERT INTO shifts (id, client_id, starts_at, ends_at, role_needed, segment, status, headcount) VALUES
  (${U1}, ${K}, now()+interval '12 hours', now()+interval '12 hours'+interval '5h', 'chef_de_partie', 'hotel', 'open', 2),
  (${U2}, ${K}, now()+interval '30 hours', now()+interval '30 hours'+interval '5h', 'bediening',      'hotel', 'open', 1),
  (${F7}, ${K}, now()+interval '5 days',   now()+interval '5 days'  +interval '5h', 'chef_de_partie', 'hotel', 'open', 1)`;
// A confirmed on U1 (→ U1 open 1) · B ACCEPTED on U2 (accepted ≠ filled → U2 open 1, acceptedUnconfirmed 1)
await sql`INSERT INTO placements (id, shift_id, chef_id, status) VALUES
  (${uuid()}, ${U1}, ${A}, 'confirmed'),
  (${uuid()}, ${U2}, ${B}, 'accepted')`;
assert("seed complete", true);

console.log("\n── getPlannerCockpit ──");
const c = await h.getPlannerCockpit();
assert("open48h = 2 shifts", c.open48h.length === 2, String(c.open48h.length));
assert("open48hSlots = 2", c.open48hSlots === 2, String(c.open48hSlots));
assert("most-urgent first = U1 (+12h)", c.open48h[0]?.id === U1, c.open48h[0]?.id);
assert("U1 open = 1 (hc2 − 1 confirmed)", c.open48h.find((s) => s.id === U1)?.open === 1, JSON.stringify(c.open48h.find((s) => s.id === U1)));
assert("U2 open = 1 (accepted ≠ filled)", c.open48h.find((s) => s.id === U2)?.open === 1);
assert("acceptedUnconfirmed = 1", c.acceptedUnconfirmed === 1, String(c.acceptedUnconfirmed));
assert("open7dCount = 3 (U1+U2+F7)", c.open7dCount === 3, String(c.open7dCount));
assert("topMatch targets U1", c.topMatch?.shift.id === U1, c.topMatch?.shift.id);
assert("topMatch.matches is an array", Array.isArray(c.topMatch?.matches));
assert("intake fields are numbers", typeof c.intake.total === "number" && typeof c.intake.chefs === "number");

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓ (throwaway clone — no cleanup needed)");
