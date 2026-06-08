/**
 * Recurrence smoke — proves expandOccurrences (klant recurring requests, B4)
 * gets the date math right: inclusive end, correct weekly/biweekly step, the
 * 12-occurrence cap, and degenerate inputs falling back to a single date.
 *
 *     npx tsx scripts/smoke-recurrence.mts
 *
 * Pure function — no DB, no env.
 */
const { expandOccurrences, MAX_OCCURRENCES } = await import("@/lib/recurrence");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log("  ✓", name);
    pass++;
  } else {
    console.log("  ✗", name, detail ? `— ${detail}` : "");
    fail++;
  }
}

console.log("=== recurrence smoke ===\n");

const w = expandOccurrences("2026-06-01", "weekly", "2026-06-29");
assert("weekly 06-01…06-29 → 5 occurrences", w.length === 5, w.join(","));
assert("weekly: first=start, last=until (inclusive)", w[0] === "2026-06-01" && w[4] === "2026-06-29", w.join(","));
assert("weekly: 7-day step", w[1] === "2026-06-08" && w[2] === "2026-06-15", w.join(","));

const b = expandOccurrences("2026-06-01", "biweekly", "2026-06-29");
assert("biweekly 06-01…06-29 → 3 (01,15,29)", b.length === 3 && b[1] === "2026-06-15" && b[2] === "2026-06-29", b.join(","));

const capped = expandOccurrences("2026-01-01", "weekly", "2027-01-01");
assert(`capped at MAX_OCCURRENCES (${MAX_OCCURRENCES})`, capped.length === MAX_OCCURRENCES, `len=${capped.length}`);

assert("until == start → single", expandOccurrences("2026-06-01", "weekly", "2026-06-01").length === 1);
assert(
  "until < start → just [start]",
  JSON.stringify(expandOccurrences("2026-06-10", "weekly", "2026-06-01")) === JSON.stringify(["2026-06-10"]),
);
assert(
  "no until → just [start]",
  JSON.stringify(expandOccurrences("2026-06-10", "weekly", "")) === JSON.stringify(["2026-06-10"]),
);
assert("empty start → []", expandOccurrences("", "weekly", "2026-06-29").length === 0);

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
