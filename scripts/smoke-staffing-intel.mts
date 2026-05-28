/**
 * PR-1.5 smoke — profile-completeness + staffing-intelligence (pure, no DB).
 *   npx tsx scripts/smoke-staffing-intel.mts
 */

const pc = await import("@/lib/domain/profile-completeness");
const si = await import("@/lib/domain/staffing-intelligence");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

console.log("=== PR-1.5 staffing-intelligence smoke ===\n");

console.log("── profile completeness ──");
{
  const full = pc.getProfileCompleteness({
    vakniveau: "sous_chef", city: "Amsterdam", segments: ["hotel"], yearsExperience: 7,
    hourlyRateMinCents: 2800, email: "a@b.nl", phone: "0612345678", specialties: "BBQ", languages: ["NL", "EN"],
    postcode: "1011AB", transportMode: "car", preferences: ["bbq"],
  });
  assert("full profile → high score", full.score >= 90, String(full.score));
  assert("full profile canMatch", full.canMatch === true);
  assert("full profile canEstimateTravel (postcode)", full.canEstimateTravel === true);
  assert("full profile label compleet", full.label === "compleet");

  const empty = pc.getProfileCompleteness({});
  assert("empty → low score", empty.score < 25, String(empty.score));
  assert("empty → canMatch false", empty.canMatch === false);
  assert("empty → onbruikbaar", empty.label === "onbruikbaar");
  assert("empty → missingCritical has vakniveau+stad+tarief", ["vakniveau", "stad", "tarief"].every((k) => empty.missingCritical.includes(k)));

  const noRate = pc.getProfileCompleteness({ vakniveau: "commis", city: "Utrecht", email: "x@y.nl" });
  assert("no rate → tarief in missingCritical", noRate.missingCritical.includes("tarief"));
  assert("no postcode → canEstimateTravel false", noRate.canEstimateTravel === false);
}

console.log("\n── candidate badges ──");
{
  const badges = si.getChefCandidateBadges({ matchScore: 86, rateCents: 2800, availability: "available", workedHereCount: 3 });
  const labels = badges.map((b) => b.label);
  assert("match badge", labels.some((l) => l.includes("match 86")));
  assert("worked-here badge", labels.some((l) => l.includes("hier 3×")));
  assert("availability badge", labels.includes("beschikbaar"));
  assert("rate badge", labels.some((l) => l.includes("€28/u")));
}

console.log("\n── candidate warnings ──");
{
  const w = si.getChefCandidateWarnings({ matchScore: 70 }); // no availability, no rate
  assert("beschikbaarheid onbekend", w.includes("beschikbaarheid onbekend"));
  assert("geen tarief", w.includes("geen tarief"));
  const w2 = si.getChefCandidateWarnings({ rateCents: 2500, availability: "available", completeness: pc.getProfileCompleteness({ vakniveau: "commis" }) });
  assert("mist critical surfaced", w2.some((x) => x.startsWith("mist:")));
}

console.log("\n── confidence ──");
{
  const comp = pc.getProfileCompleteness({ vakniveau: "sous_chef", city: "Adam", hourlyRateMinCents: 2800, email: "a@b.nl" });
  assert("high + available → hoog", si.getMatchConfidenceLabel({ matchScore: 88, availability: "available", completeness: comp }).label === "hoog");
  assert("unavailable → laag", si.getMatchConfidenceLabel({ matchScore: 90, availability: "unavailable", completeness: comp }).label === "laag");
  assert("low score → laag", si.getMatchConfidenceLabel({ matchScore: 30, availability: "available", completeness: comp }).label === "laag");
  const mid = si.getMatchConfidenceLabel({ matchScore: 70, completeness: comp }); // unknown availability
  assert("mid score + unknown avail → midden", mid.label === "midden");
  assert("midden surfaces reason", mid.reason === "beschikbaarheid onbekend");
  assert("incomplete profile → laag", si.getMatchConfidenceLabel({ matchScore: 90, availability: "available", completeness: pc.getProfileCompleteness({}) }).label === "laag");
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
