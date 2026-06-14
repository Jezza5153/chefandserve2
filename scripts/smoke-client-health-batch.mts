/**
 * smoke-client-health-batch — Wave 3 drift guard. The owner clients-list uses a BATCHED
 * getClientHealthVerdicts(ids); the detail page + clients.health AI tool use the
 * single-client getClientHealth(id) (via getClientSummary). They must agree exactly, or
 * the list shows a different verdict than the detail. This runs both over real dev clients
 * and asserts the verdicts are identical.
 *
 * Run: npx tsx --env-file=.env.local scripts/smoke-client-health-batch.mts
 */
import { isNull } from "drizzle-orm";

const { db } = await import("@/lib/db/client");
const { clients } = await import("@/lib/db/schema");
const { getClientHealth, getClientHealthVerdicts } = await import("@/lib/domain/client-history");

let pass = 0;
let fail = 0;
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const rows = await db
  .select({ id: clients.id })
  .from(clients)
  .where(isNull(clients.deletedAt))
  .limit(12);
const ids = rows.map((r) => r.id);
console.log(`Cross-checking batched vs single-client health for ${ids.length} dev clients…`);

const batch = await getClientHealthVerdicts(ids);

// 1. one verdict per requested id
if (batch.size === ids.length) {
  pass++;
  console.log(`  ✓ batch returned ${batch.size}/${ids.length} verdicts`);
} else {
  fail++;
  console.log(`  ✗ batch returned ${batch.size}, expected ${ids.length}`);
}

// 2. each batched verdict equals the single-client verdict (level + chips + actions)
for (const id of ids) {
  const single = await getClientHealth(id);
  const b = batch.get(id);
  const sv = single?.verdict;
  const ok =
    !!b &&
    !!sv &&
    b.level === sv.level &&
    b.headline === sv.headline &&
    eq(b.strengths, sv.strengths) &&
    eq(b.watchpoints, sv.watchpoints) &&
    eq(b.nextActions, sv.nextActions);
  if (ok) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ verdict mismatch for ${id}: batch=${JSON.stringify(b)} single=${JSON.stringify(sv)}`);
  }
}
if (fail === 0) console.log(`  ✓ all ${ids.length} verdicts match the single-client path`);

console.log(`\n=== smoke-client-health-batch: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
