/**
 * Klant 360 health verdict smoke — pure, no DB/network.
 *   npx tsx scripts/smoke-client-health.mts
 */
const { computeClientHealth } = await import("@/lib/domain/client-health");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

const base = {
  status: "active",
  completedShifts: 0,
  upcomingShifts: 0,
  marginCents: 0,
  spendCents: 0,
  repeatChefs: 0,
  ratingsGiven: 0,
  pendingSignoff: 0,
  signoffAvgHours: null as number | null,
};

console.log("=== Klant health verdict ===\n");

{
  const v = computeClientHealth({ ...base, completedShifts: 18, upcomingShifts: 4, spendCents: 100000, marginCents: 30000, repeatChefs: 3, ratingsGiven: 10, signoffAvgHours: 12 });
  assert("strong klant → sterk", v.level === "sterk", v.level);
  assert("strong klant has strengths", v.strengths.length >= 2);
  assert("strong klant no watchpoints", v.watchpoints.length === 0);
}
{
  const v = computeClientHealth({ ...base, completedShifts: 8, spendCents: 100000, marginCents: -5000 });
  assert("negative margin → aandacht", v.level === "aandacht", v.level);
  assert("negative margin flagged", v.watchpoints.some((w) => w.toLowerCase().includes("marge negatief")));
}
{
  const v = computeClientHealth({ ...base, completedShifts: 5, upcomingShifts: 2, spendCents: 100000, marginCents: 25000, pendingSignoff: 4 });
  assert("many unsigned hours → aandacht", v.level === "aandacht", v.level);
  assert("unsigned hours flagged", v.watchpoints.some((w) => w.includes("handtekening")));
}
{
  const v = computeClientHealth({ ...base, completedShifts: 6, upcomingShifts: 0, spendCents: 60000, marginCents: 18000, repeatChefs: 1 });
  assert("dormant-with-history flagged", v.watchpoints.some((w) => w.toLowerCase().includes("geen nieuwe diensten")));
}
{
  const v = computeClientHealth({ ...base, status: "prospect", completedShifts: 0 });
  assert("brand-new prospect → goed (not aandacht)", v.level === "goed", v.level);
}
{
  const v = computeClientHealth({ ...base, status: "archived", completedShifts: 12, spendCents: 100000, marginCents: 30000 });
  assert("archived → aandacht", v.level === "aandacht", v.level);
}
{
  const v = computeClientHealth({ ...base, completedShifts: 5, spendCents: 100000, marginCents: 25000, ratingsGiven: 0, upcomingShifts: 1 });
  assert("no feedback given flagged", v.watchpoints.some((w) => w.toLowerCase().includes("feedback")));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
