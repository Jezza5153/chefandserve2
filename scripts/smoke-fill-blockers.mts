/**
 * P3 blocker explanation — summarizeFillBlockers: WHY is a shift with candidates still
 * hard to fill? Counts per category (compliance / klant-block / reisafstand / marge) and
 * returns ordered Dutch phrases. Pure → run: npx tsx scripts/smoke-fill-blockers.mts
 */
const { summarizeFillBlockers } = await import("@/lib/domain/fill-blockers");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

const ok = { complianceBlocked: false, marginNegative: false, outOfRadius: false, klantBlocked: false };

console.log("=== Fill blockers explanation (pure) ===\n");

assert("all-fine candidates → no blockers", summarizeFillBlockers([ok, ok]).length === 0);
assert("empty list → no blockers", summarizeFillBlockers([]).length === 0);

const compliance = summarizeFillBlockers([{ ...ok, complianceBlocked: true }, { ...ok, complianceBlocked: true }, ok]);
assert("2 compliance-blocked → '2 kandidaten niet inzetbaar'", compliance[0] === "2 kandidaten niet inzetbaar (VOG/ID/contract)", compliance.join(" | "));

const one = summarizeFillBlockers([{ ...ok, klantBlocked: true }]);
assert("singular '1 kandidaat'", one[0] === "1 kandidaat door klant geblokkeerd", one.join(" | "));

const radius = summarizeFillBlockers([{ ...ok, outOfRadius: true }]);
assert("out-of-radius phrase", radius[0] === "1 kandidaat buiten reisafstand", radius.join(" | "));

const margin = summarizeFillBlockers([{ ...ok, marginNegative: true }, { ...ok, marginNegative: true }]);
assert("margin phrase plural", margin[0] === "marge negatief bij 2 kandidaten", margin.join(" | "));

// Ordering: compliance > klant > radius > margin; one phrase per applicable category.
const all = summarizeFillBlockers([
  { complianceBlocked: true, klantBlocked: true, outOfRadius: true, marginNegative: true },
]);
assert("one phrase per category (4)", all.length === 4, String(all.length));
assert("order compliance→klant→radius→marge",
  all[0].includes("inzetbaar") && all[1].includes("geblokkeerd") && all[2].includes("reisafstand") && all[3].includes("marge"),
  all.join(" | "));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
