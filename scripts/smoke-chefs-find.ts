/**
 * Smoke: chefs.find actually RUNS.
 *
 * WHY THIS EXISTS. `chefs.find` raised `operator does not exist: text[] ~~* unknown` on
 * every non-empty query in production (audit_log over 60 days: 11 failures, 2 successes)
 * and nobody noticed, because:
 *   - scripts/eval-ai.mts only checks that the model NAMES the right tool. It calls
 *     brain.plan and never executes anything, so a tool that throws 100% of the time
 *     scores a pass — and ~17 cases list chefs.find as a correct route.
 *   - runtime/execute.ts catches tool exceptions and returns a polite Dutch error, so the
 *     assistant apologised instead of crashing.
 *
 * So this smoke exercises the real query against a real Postgres. Every filter gets its own
 * case, because each one can independently fail at the SQL layer (array casts, enum
 * comparisons, unnest, date casts) in a way no type-check or routing eval can catch.
 *
 *   npx tsx --env-file=.env.local scripts/smoke-chefs-find.ts
 */
import { findChefs, type FindChefsInput } from "@/lib/ai/read-model/directory";

let pass = 0;
let fail = 0;

async function ok(name: string, input: FindChefsInput, check?: (n: number) => string | null) {
  try {
    const { chefs, notes } = await findChefs(input);
    const problem = check?.(chefs.length) ?? null;
    if (problem) {
      console.log("  ✗", name, "—", problem);
      fail++;
      return;
    }
    const n = notes.length ? ` · ${notes.length} note(s)` : "";
    console.log("  ✓", name, `— ${chefs.length} row(s)${n}`);
    pass++;
  } catch (e) {
    console.log("  ✗", name, "— THREW:", (e as Error).message);
    fail++;
  }
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "?";
  console.log(`=== chefs.find smoke (${host}) ===\n`);

  console.log("free text — every branch of the OR, including the text[] columns:");
  await ok("empty query", {});
  await ok("plain term", { q: "chef" });
  await ok("mixed case (ilike, not like)", { q: "AmStErDaM" });
  await ok("term with a quote", { q: "o'brien" });
  await ok("term with a percent sign", { q: "100%" });
  await ok("unicode", { q: "café" });

  console.log("\nstructured filters — each can fail independently at the SQL layer:");
  await ok("city", { city: "Amsterdam" });
  await ok("vakniveau (enum comparison)", { vakniveau: "sous_chef" });
  await ok("segment (= ANY over text[])", { segment: "hotel" });
  await ok("skillTags (&& overlap)", { skillTags: ["patisserie"] });
  await ok("skillTags multiple", { skillTags: ["patisserie", "banqueting"] });
  await ok("language (unnest + ilike)", { language: "NL" });
  await ok("maxRateCents", { maxRateCents: 3500 });
  await ok("minRating", { minRating: 4 });
  await ok("availableOn (date cast + NOT EXISTS)", { availableOn: "2026-08-01" });
  await ok("includeInactive", { includeInactive: true });

  console.log("\ncombined — the real shape of a Maarten question:");
  await ok("3 constraints AND-ed", {
    vakniveau: "sous_chef",
    city: "Amsterdam",
    language: "NL",
  });
  await ok("everything at once", {
    q: "chef",
    city: "Amsterdam",
    vakniveau: "sous_chef",
    segment: "hotel",
    skillTags: ["patisserie"],
    language: "NL",
    maxRateCents: 5000,
    minRating: 3,
    availableOn: "2026-08-01",
    limit: 5,
  });

  console.log("\nbehaviour, not just 'does not throw':");
  await ok("bad date is reported, not silently dropped", { availableOn: "volgende week" }, () => null);
  {
    const { notes } = await findChefs({ availableOn: "volgende week" });
    const told = notes.some((n) => n.toLowerCase().includes("geen geldige datum"));
    console.log(told ? "  ✓ invalid date surfaces a note" : "  ✗ invalid date was silently ignored");
    told ? pass++ : fail++;
  }
  {
    const { chefs } = await findChefs({ includeInactive: false, limit: 25 });
    const bad = chefs.filter((c) => !["active", "onboarding"].includes(c.status));
    console.log(bad.length === 0 ? "  ✓ archived chefs excluded by default" : `  ✗ ${bad.length} non-deployable chef(s) returned`);
    bad.length === 0 ? pass++ : fail++;
  }
  {
    // Deterministic order: the same query twice must give the same sequence. Before the
    // fix the ordering had no stable tail, so tied chefs came back in arbitrary row order.
    const a = (await findChefs({ limit: 25 })).chefs.map((c) => c.id).join(",");
    const b = (await findChefs({ limit: 25 })).chefs.map((c) => c.id).join(",");
    console.log(a === b ? "  ✓ ordering is deterministic" : "  ✗ same query returned a different order");
    a === b ? pass++ : fail++;
  }
  {
    // Volume before average — a single 5.0 must not outrank a well-reviewed 4.8.
    const { chefs } = await findChefs({ limit: 25 });
    const rated = chefs.filter((c) => (c.ratingCount ?? 0) >= 3);
    const thin = chefs.filter((c) => (c.ratingCount ?? 0) < 3);
    const okOrder =
      rated.length === 0 || thin.length === 0 ||
      chefs.indexOf(rated[rated.length - 1]) < chefs.indexOf(thin[0]);
    console.log(okOrder ? "  ✓ well-reviewed chefs rank above thinly-reviewed ones" : "  ✗ rating volume is not respected");
    okOrder ? pass++ : fail++;
  }

  console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
