/**
 * PR-1 smoke — the roster intelligence helpers (pure, no DB). Run with tsx:
 *   npx tsx scripts/smoke-roster-intel.mts
 * Pins Amsterdam-day bucketing + week/month ranges + health/next-action/warnings/
 * fill across every branch, with a fixed "now" for determinism.
 */

const m = await import("@/lib/roster-format");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— got ${detail}` : ""); fail++; }
}

// Mon 2026-06-15, 12:00 Amsterdam (CEST = UTC+2)
const NOW = new Date("2026-06-15T10:00:00Z");
type Over = Partial<Parameters<typeof m.getShiftHealth>[0]>;
const shift = (over: Over) => ({
  startsAt: "2026-06-20T10:00:00Z",
  endsAt: "2026-06-20T18:00:00Z",
  status: "open",
  headcount: 2,
  confirmedCount: 0,
  location: "Amsterdam",
  city: "Amsterdam",
  hasClient: true,
  now: NOW,
  ...over,
});

console.log("=== PR-1 roster intelligence smoke ===\n");

console.log("── Amsterdam day keys (DST) ──");
assert("23:30 UTC summer → next Amsterdam day", m.amsterdamDayKey("2026-06-15T23:30:00Z") === "2026-06-16");
assert("23:30 UTC winter → next Amsterdam day", m.amsterdamDayKey("2026-01-15T23:30:00Z") === "2026-01-16");
assert("10:00 UTC → same Amsterdam day", m.amsterdamDayKey("2026-06-15T10:00:00Z") === "2026-06-15");

console.log("\n── week range ──");
{
  const w = m.getAmsterdamWeekRange("2026-06-17"); // a Wednesday
  assert("Monday start", w.startKey === "2026-06-15");
  assert("Sunday end", w.endKey === "2026-06-21");
  assert("7 day keys", w.days.length === 7 && w.days[0] === "2026-06-15" && w.days[6] === "2026-06-21");
  assert("startUtc = Mon 00:00 CEST (22:00Z prev day)", w.startUtc.toISOString().startsWith("2026-06-14T22:00"));
  assert("endUtc = next Mon 00:00 CEST", w.endUtc.toISOString().startsWith("2026-06-21T22:00"));
}

console.log("\n── month grid ──");
{
  const g = m.getAmsterdamMonthGrid("2026-06-10");
  assert("42 cells", g.gridDays.length === 42);
  assert("monthKey", g.monthKey === "2026-06");
  assert("June has 30 in-month days", g.inMonth.filter(Boolean).length === 30);
  assert("grid contains 2026-06-01", g.gridDays.includes("2026-06-01"));
  assert("shiftMonthKey +1 → July", m.shiftMonthKey("2026-06", 1) === "2026-07-01");
  assert("shiftMonthKey -6 → previous year", m.shiftMonthKey("2026-06", -6) === "2025-12-01");
}

console.log("\n── date math ──");
assert("year rollover +1", m.addDaysToKey("2026-12-31", 1) === "2027-01-01");
assert("month rollback -1", m.addDaysToKey("2026-03-01", -1) === "2026-02-28");

console.log("\n── bucketing ──");
{
  const buckets = m.bucketShiftsByAmsterdamDay([
    { startsAt: "2026-06-15T10:00:00Z" },
    { startsAt: "2026-06-15T23:30:00Z" }, // → 06-16 Amsterdam
    { startsAt: "2026-06-16T08:00:00Z" },
  ]);
  assert("split across Amsterdam days", buckets.get("2026-06-15")?.length === 1 && buckets.get("2026-06-16")?.length === 2);
}

console.log("\n── getShiftHealth ──");
assert("cancelled", m.getShiftHealth(shift({ status: "cancelled" })) === "cancelled");
assert("past → done", m.getShiftHealth(shift({ startsAt: "2026-06-14T10:00:00Z", endsAt: "2026-06-14T18:00:00Z" })) === "done");
assert("completed → done", m.getShiftHealth(shift({ status: "completed" })) === "done");
assert("headcount 0 → attention", m.getShiftHealth(shift({ headcount: 0 })) === "attention");
assert("full → healthy", m.getShiftHealth(shift({ confirmedCount: 2 })) === "healthy");
assert("full but no location → attention", m.getShiftHealth(shift({ confirmedCount: 2, location: null, city: null })) === "attention");
assert("<24h & under → critical", m.getShiftHealth(shift({ startsAt: "2026-06-15T20:00:00Z", endsAt: "2026-06-16T02:00:00Z", confirmedCount: 1 })) === "critical");
assert("future, 0 confirmed → empty", m.getShiftHealth(shift({ confirmedCount: 0 })) === "empty");
assert("future, partial → underfilled", m.getShiftHealth(shift({ headcount: 3, confirmedCount: 1 })) === "underfilled");

console.log("\n── getShiftNextAction ──");
assert("cancelled", m.getShiftNextAction(shift({ status: "cancelled" })) === "Geannuleerd");
assert("past", m.getShiftNextAction(shift({ startsAt: "2026-06-14T10:00:00Z", endsAt: "2026-06-14T18:00:00Z" })) === "Afgerond");
assert("no client", m.getShiftNextAction(shift({ hasClient: false })) === "Gegevens checken");
assert("no location", m.getShiftNextAction(shift({ location: null, city: null })) === "Gegevens checken");
assert("full → Vol", m.getShiftNextAction(shift({ confirmedCount: 2 })) === "Vol");
assert("partial → Aanvullen", m.getShiftNextAction(shift({ headcount: 3, confirmedCount: 1 })) === "Aanvullen");
assert("accepted → Bevestig plaatsing", m.getShiftNextAction(shift({ acceptedCount: 1 })) === "Bevestig plaatsing");
assert("proposed → Wacht op reactie", m.getShiftNextAction(shift({ proposedCount: 1 })) === "Wacht op reactie");
assert("nothing → Chef zoeken", m.getShiftNextAction(shift({})) === "Chef zoeken");

console.log("\n── getShiftWarnings ──");
{
  const w = m.getShiftWarnings(shift({ hasClient: false, location: null, city: null, headcount: 0 }));
  assert("3 warnings when all missing", w.length === 3);
  assert("none when complete", m.getShiftWarnings(shift({})).length === 0);
}

console.log("\n── getFillState ──");
assert("full", m.getFillState(shift({ confirmedCount: 2 })) === "full");
assert("partial", m.getFillState(shift({ headcount: 3, confirmedCount: 1 })) === "partial");
assert("empty (not soon)", m.getFillState(shift({ confirmedCount: 0 })) === "empty");
assert("emptySoon (<24h)", m.getFillState(shift({ startsAt: "2026-06-15T20:00:00Z", confirmedCount: 0 })) === "emptySoon");
assert("unknown (headcount 0)", m.getFillState(shift({ headcount: 0 })) === "unknown");

console.log("\n── needsAttention ──");
assert("critical needs attention", m.needsAttention(shift({ startsAt: "2026-06-15T20:00:00Z", confirmedCount: 1 })) === true);
assert("healthy does not", m.needsAttention(shift({ confirmedCount: 2 })) === false);
assert("empty needs attention", m.needsAttention(shift({})) === true);

console.log("\n── tunable settings (future Instellingen page) ──");
{
  // shift 30h out, under headcount: default 24h → empty; criticalHours 48 → critical
  const far = { startsAt: "2026-06-16T16:00:00Z", confirmedCount: 0 };
  assert("default 24h → empty at 30h out", m.getShiftHealth(shift(far)) === "empty");
  assert("criticalHours=48 → critical at 30h out", m.getShiftHealth(shift({ ...far, settings: { criticalHours: 48 } })) === "critical");
  assert("label override applies", m.getShiftNextAction(shift({ settings: { labels: { findChef: "Bel rondje" } } })) === "Bel rondje");
  assert("DEFAULT_ROSTER_SETTINGS critical is 24h", m.DEFAULT_ROSTER_SETTINGS.criticalHours === 24);
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
