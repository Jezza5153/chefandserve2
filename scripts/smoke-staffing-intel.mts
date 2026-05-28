/**
 * PR-1.5 + PR-3.1 smoke — profile-completeness + staffing-intelligence
 * (badges · warnings · confidence · rank score · match explanation). Pure, no DB.
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

console.log("\n── PR-3.1 rank score ──");
{
  assert("blocked → -1 (hard exclude)", si.getRankScore({ matchScore: 95, isBlocked: true }) === -1);
  assert("favorite → +12", si.getRankScore({ matchScore: 70, isFavorite: true }) === 82);
  assert("available → +8", si.getRankScore({ matchScore: 70, availability: "available" }) === 78);
  assert("unavailable → -25", si.getRankScore({ matchScore: 70, availability: "unavailable" }) === 45);
  assert("worked-here capped at 3× (+12)", si.getRankScore({ matchScore: 50, workedHereCount: 10 }) === 62);
  assert("negative margin → -25", si.getRankScore({ matchScore: 80, marginTone: "negative" }) === 55);
  assert("low margin → -8", si.getRankScore({ matchScore: 80, marginTone: "low" }) === 72);
  assert("far (>40km) → -10", si.getRankScore({ matchScore: 80, distanceKm: 50 }) === 70);
  assert("mid distance (>25km) → -5", si.getRankScore({ matchScore: 80, distanceKm: 30 }) === 75);

  // Composite ordering: strong-fit favorite outranks unavailable-far, blocked at bottom.
  const a = { matchScore: 60, availability: "available" as const, isFavorite: true, workedHereCount: 3 }; // 92
  const b = { matchScore: 95, isBlocked: true }; // -1
  const c = { matchScore: 85, availability: "unavailable" as const, distanceKm: 50 }; // 50
  const ranked = [a, b, c].sort((x, y) => si.getRankScore(y) - si.getRankScore(x));
  assert("ranked order A > C > B", ranked[0] === a && ranked[1] === c && ranked[2] === b,
    ranked.map((s) => si.getRankScore(s)).join(","));
}

console.log("\n── PR-3.1 match explanation ──");
{
  const strong = si.getChefMatchExplanation({
    matchScore: 88, isFavorite: true, workedHereCount: 3, availability: "available",
    distanceKm: 8, marginTone: "ok", rateCents: 2800,
  });
  assert("strong reasons: sterke match", strong.reasons.includes("sterke match"));
  assert("strong reasons: klant-favoriet", strong.reasons.includes("klant-favoriet"));
  assert("strong reasons: eerder hier (3×)", strong.reasons.includes("eerder hier (3×)"));
  assert("strong reasons: beschikbaar", strong.reasons.includes("beschikbaar"));
  assert("strong reasons: dichtbij (8 km)", strong.reasons.includes("dichtbij (8 km)"));
  assert("strong reasons: gezonde marge", strong.reasons.includes("gezonde marge"));
  assert("strong → no warnings", strong.warnings.length === 0, strong.warnings.join(","));
  assert("strong → no nextCheck", strong.nextCheck.length === 0, strong.nextCheck.join(","));

  const risky = si.getChefMatchExplanation({ matchScore: 60, marginTone: "negative", distanceKm: 50, isBlocked: true });
  assert("risky warns: negatieve marge", risky.warnings.includes("negatieve marge"));
  assert("risky warns: ver weg (50 km)", risky.warnings.includes("ver weg (50 km)"));
  assert("risky warns: door klant geblokkeerd", risky.warnings.includes("door klant geblokkeerd"));
  assert("risky nextCheck: beschikbaarheid bevestigen", risky.nextCheck.includes("beschikbaarheid bevestigen"));
  assert("risky nextCheck: tarief opvragen", risky.nextCheck.includes("tarief opvragen"));

  const low = si.getChefMatchExplanation({ matchScore: 70, marginTone: "low", rateCents: 2500, availability: "available" });
  assert("low margin → lage marge warning", low.warnings.includes("lage marge"));
  assert("low margin (rate+avail known) → no nextCheck", low.nextCheck.length === 0, low.nextCheck.join(","));
}

console.log("\n── PR-5 waarom-niet-nr-1 gap ──");
{
  const top = {
    matchScore: 90, availability: "available" as const, isFavorite: true,
    workedHereCount: 3, distanceKm: 5, marginTone: "ok" as const,
  };
  const weak = {
    matchScore: 70, availability: "unknown" as const, isFavorite: false,
    workedHereCount: 0, distanceKm: 30, marginTone: "low" as const,
  };
  const gap = si.getRankGapReasons(top, weak);
  assert("gap capped at 2", gap.length <= 2, gap.join(","));
  assert("gap leads with availability", gap[0] === "nr 1 is beschikbaar", gap.join(","));

  assert("tied candidates → no gap", si.getRankGapReasons(
    { matchScore: 80, availability: "available" },
    { matchScore: 80, availability: "available" },
  ).length === 0);

  const distGap = si.getRankGapReasons({ matchScore: 80, distanceKm: 5 }, { matchScore: 80, distanceKm: 30 });
  assert("distance gap surfaced", distGap.some((g) => g.startsWith("verder weg dan nr 1")), distGap.join(","));

  const scoreGap = si.getRankGapReasons({ matchScore: 90 }, { matchScore: 70 });
  assert("match-score gap surfaced", scoreGap.includes("lagere match-score (70 vs 90)"), scoreGap.join(","));
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
