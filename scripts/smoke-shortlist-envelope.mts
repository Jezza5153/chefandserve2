/**
 * smoke-shortlist-envelope — pure checks for buildShortlistEnvelope (P5a-2). No DB/LLM.
 * The module has no AI/server imports, so a plain dynamic import runs clean.
 */
const { buildShortlistEnvelope } = await import("../src/lib/shortlist-envelope.ts");

let pass = 0;
const fail: string[] = [];
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else fail.push(name);
}

const okStep = (shiftId: string, matches: unknown) => ({
  tool: "shifts.suggest_chefs",
  input: { shiftId },
  result: { status: "ok", data: { count: Array.isArray(matches) ? matches.length : 0, matches } },
});
const match = (chefId: string, chefName: string, score: number, reasons: string[] = [], warnings: string[] = []) => ({ chefId, chefName, score, reasons, warnings });

// 1. happy path → shiftId + mapped items (chefId/name/score/first-reason)
{
  const env = buildShortlistEnvelope([okStep("s1", [match("c1", "Sam", 92, ["ontbijt", "dichtbij"]), match("c2", "Andre", 80, ["hotel"])])]);
  ok("happy: not null", env !== null);
  ok("happy: shiftId", env?.shiftId === "s1");
  ok("happy: 2 items", env?.items.length === 2);
  ok("happy: first item maps", env?.items[0].chefId === "c1" && env?.items[0].chefName === "Sam" && env?.items[0].score === 92);
  ok("happy: first reason only", env?.items[0].reason === "ontbijt");
  ok("happy: empty reasons → ''", buildShortlistEnvelope([okStep("s1", [match("c1", "Sam", 90)])])?.items[0].reason === "");
}

// 1b. warnings carry through (joined); empty when none
{
  const env = buildShortlistEnvelope([okStep("s1", [match("c1", "Sam", 90, ["ontbijt"], ["heeft deze dienst eerder afgewezen", "buiten reisafstand"])])]);
  ok("warning: joined", env?.items[0].warning === "heeft deze dienst eerder afgewezen · buiten reisafstand");
  ok("warning: empty when none", buildShortlistEnvelope([okStep("s1", [match("c1", "Sam", 90, ["ontbijt"])])])?.items[0].warning === "");
}

// 2. picks the LAST successful suggest_chefs step
{
  const env = buildShortlistEnvelope([
    okStep("sA", [match("c1", "A", 50)]),
    { tool: "shifts.find", input: {}, result: { status: "ok", data: {} } },
    okStep("sB", [match("c2", "B", 60)]),
  ]);
  ok("last: shiftId is sB", env?.shiftId === "sB");
  ok("last: item is c2", env?.items[0].chefId === "c2");
}

// 3. ignores non-ok suggest steps
{
  const env = buildShortlistEnvelope([{ tool: "shifts.suggest_chefs", input: { shiftId: "s1" }, result: { status: "error" } }]);
  ok("non-ok → null", env === null);
}

// 4. no suggest step at all → null
{
  ok("no suggest → null", buildShortlistEnvelope([{ tool: "shifts.find", input: {}, result: { status: "ok", data: {} } }]) === null);
  ok("empty steps → null", buildShortlistEnvelope([]) === null);
  ok("undefined → null", buildShortlistEnvelope(undefined) === null);
  ok("null → null", buildShortlistEnvelope(null) === null);
}

// 5. zero matches → null (chat stays text-only)
{
  ok("0 matches → null", buildShortlistEnvelope([okStep("s1", [])]) === null);
}

// 6. drops malformed rows (missing chefId/name); keeps the valid ones
{
  const env = buildShortlistEnvelope([
    okStep("s1", [{ chefName: "NoId", score: 10, reasons: [] }, match("c2", "Good", 70), { chefId: "c3", score: 5, reasons: [] }]),
  ]);
  ok("malformed: only valid kept", env?.items.length === 1 && env?.items[0].chefId === "c2");
}

// 7. caps at 5 items
{
  const many = Array.from({ length: 8 }, (_, i) => match(`c${i}`, `Chef ${i}`, 90 - i));
  ok("caps at 5", buildShortlistEnvelope([okStep("s1", many)])?.items.length === 5);
}

// 8. score clamped + rounded; missing shiftId → null
{
  ok("score clamp >100", buildShortlistEnvelope([okStep("s1", [match("c1", "A", 150)])])?.items[0].score === 100);
  ok("score round", buildShortlistEnvelope([okStep("s1", [match("c1", "A", 87.6)])])?.items[0].score === 88);
  ok("score NaN → 0", buildShortlistEnvelope([okStep("s1", [match("c1", "A", Number.NaN)])])?.items[0].score === 0);
  ok("no shiftId → null", buildShortlistEnvelope([{ tool: "shifts.suggest_chefs", input: {}, result: { status: "ok", data: { matches: [match("c1", "A", 50)] } } }]) === null);
}

if (fail.length) {
  console.error(`smoke-shortlist-envelope FAILED (${fail.length}): ${fail.join(", ")}`);
  process.exit(1);
}
console.log(`smoke-shortlist-envelope OK — ${pass} checks passed`);
