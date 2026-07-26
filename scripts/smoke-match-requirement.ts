/**
 * Smoke: chefs.match_requirement RUNS and behaves.
 *
 * Same reasoning as smoke-chefs-find.ts — the routing eval never executes a tool, so
 * anything that builds SQL needs a smoke that actually hits Postgres. This one adds
 * behavioural assertions on top: the near-miss tier is the whole point of the tool, so
 * "it did not throw" is not enough.
 *
 *   npx tsx --env-file=.env.local scripts/smoke-match-requirement.ts
 */
import { matchChefsToRequirement, type ChefRequirement } from "@/lib/ai/read-model/staffing";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
};

async function runs(name: string, req: ChefRequirement) {
  try {
    const r = await matchChefsToRequirement(req);
    console.log(`  ✓ ${name} — ${r.matches.length} match(es), ${r.nearMisses.length} near-miss, ${r.notes.length} note(s)`);
    pass++;
    return r;
  } catch (e) {
    console.log("  ✗", name, "— THREW:", (e as Error).message);
    fail++;
    return null;
  }
}

async function main() {
  console.log(`=== chefs.match_requirement smoke (${(process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1]}) ===\n`);

  console.log("every filter path compiles to valid SQL:");
  await runs("role only", { roleNeeded: "sous_chef" });
  await runs("with date", { roleNeeded: "sous_chef", date: "2026-08-01" });
  await runs("with city", { roleNeeded: "sous_chef", city: "Amsterdam" });
  await runs("with segment", { roleNeeded: "sous_chef", segment: "hotel" });
  await runs("with skillTags", { roleNeeded: "patissier", skillTags: ["patisserie"] });
  await runs("with language", { roleNeeded: "sous_chef", languageRequired: "NL" });
  await runs("with minExperience", { roleNeeded: "sous_chef", minExperience: 5 });
  await runs("with maxRate", { roleNeeded: "sous_chef", maxRateCents: 3500 });
  await runs("everything at once", {
    roleNeeded: "sous_chef", date: "2026-08-01", city: "Amsterdam", segment: "hotel",
    minExperience: 3, languageRequired: "NL", maxRateCents: 9000, skillTags: ["patisserie"], limit: 5,
  });

  console.log("\nbehaviour:");
  {
    const r = await matchChefsToRequirement({ roleNeeded: "sous_chef" });
    ok("matches carry a score", r.matches.every((m) => typeof m.score === "number" && m.score > 0));
    ok("matches carry Dutch reasons", r.matches.every((m) => Array.isArray(m.reasons)));
    ok("no chef appears in both matches and nearMisses",
       !r.matches.some((m) => r.nearMisses.some((n) => n.chefId === m.chefId)));
  }
  {
    // An impossible requirement must NOT dead-end: it has to say what blocked everyone.
    const r = await matchChefsToRequirement({ roleNeeded: "executive_chef", minExperience: 49, maxRateCents: 1 });
    ok("impossible requirement returns no matches", r.matches.length === 0);
    ok("…but explains why, via nearMisses", r.nearMisses.length > 0,
       "nearMisses was empty — Maarten would get a dead end");
    ok("…and every near-miss names its blocking constraint",
       r.nearMisses.every((n) => typeof n.blockedBy === "string" && n.blockedBy.length > 3));
  }
  {
    const a = await matchChefsToRequirement({ roleNeeded: "sous_chef" });
    const b = await matchChefsToRequirement({ roleNeeded: "sous_chef" });
    ok("ordering is deterministic",
       a.matches.map((m) => m.chefId).join(",") === b.matches.map((m) => m.chefId).join(","));
  }
  {
    const r = await matchChefsToRequirement({ roleNeeded: "sous_chef", date: "volgende week" });
    ok("an invalid date is reported, not silently ignored",
       r.notes.some((n) => n.includes("geen geldige datum")));
  }
  {
    const r = await matchChefsToRequirement({ roleNeeded: "sous_chef", date: "2026-08-01" });
    ok("availability uncertainty is stated honestly",
       r.notes.some((n) => n.toLowerCase().includes("niet bekend")),
       "no row = available, so we must never imply a chef is confirmed free");
  }
  {
    const r = await matchChefsToRequirement({ roleNeeded: "sous_chef", limit: 2 });
    ok("limit is respected", r.matches.length <= 2);
  }

  console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
