/**
 * smoke-json-for-brain — element-aware truncation (audit gap #8): a big tool result must
 * stay VALID JSON (no mid-object cut) and tell the model it's a subset, so it can't answer
 * "8 chefs" when there were 25. Imports agent.ts (pulls the AI chain) → run with dummy env.
 */
const { jsonForBrain } = await import("../src/lib/ai/runtime/agent.ts");

let pass = 0;
const fail: string[] = [];
const ok = (n: string, c: boolean) => (c ? pass++ : fail.push(n));

// small data → unchanged + valid JSON
{
  const out = jsonForBrain({ a: 1, b: "x" });
  ok("small: unchanged", out === JSON.stringify({ a: 1, b: "x" }));
}
ok("null → ''", jsonForBrain(null) === "");
ok("undefined → ''", jsonForBrain(undefined) === "");
ok("empty obj → ''", jsonForBrain({}) === "");
ok("empty arr → ''", jsonForBrain([]) === "");

const MAX = 200; // small budget to force truncation deterministically

// big bare ARRAY → trimmed, head is parseable, marker shows total
{
  const arr = Array.from({ length: 40 }, (_, i) => ({ id: i, name: `chef-${i}`, city: "Amsterdam" }));
  const out = jsonForBrain(arr, MAX);
  const head = out.split("\n…")[0];
  let parsed: unknown = null;
  try { parsed = JSON.parse(head); } catch { /* */ }
  ok("array: head is valid JSON", Array.isArray(parsed));
  ok("array: trimmed below full", (parsed as unknown[]).length < 40 && (parsed as unknown[]).length >= 1);
  ok("array: marker shows total 40", out.includes("van 40"));
  ok("array: under budget-ish", head.length <= MAX);
}

// big OBJECT with an array field → field trimmed, object still parseable, marker names the field
{
  const data = { count: 40, query: "amsterdam", matches: Array.from({ length: 40 }, (_, i) => ({ id: i, name: `c${i}`, blurb: "x".repeat(20) })) };
  const out = jsonForBrain(data, MAX);
  const head = out.split("\n…")[0];
  let parsed: { count?: number; matches?: unknown[] } | null = null;
  try { parsed = JSON.parse(head); } catch { /* */ }
  ok("object: head is valid JSON", parsed !== null && Array.isArray(parsed.matches));
  ok("object: keeps the count field", parsed?.count === 40);
  ok("object: matches trimmed", (parsed?.matches?.length ?? 99) < 40);
  ok("object: marker names the field", out.includes("matches:") && out.includes("van 40"));
}

// a giant single string value (no array to trim) → last-resort char-slice, flagged incomplete
{
  const out = jsonForBrain({ blob: "x".repeat(5000) }, MAX);
  ok("blob: flagged ONVOLLEDIG", out.includes("ONVOLLEDIG"));
  ok("blob: capped near budget", out.length <= MAX + 60);
}

// a BARE array whose single element is itself bigger than the budget → must NOT blow the cap;
// trim() floors at 1, so the element-trim can't fit → fall through to the flagged char-slice.
{
  const out = jsonForBrain([{ id: 0, blob: "x".repeat(5000) }, { id: 1 }], MAX);
  ok("array-giant-element: capped near budget (cap holds)", out.length <= MAX + 60);
  ok("array-giant-element: flagged ONVOLLEDIG", out.includes("ONVOLLEDIG"));
}

if (fail.length) {
  console.error(`smoke-json-for-brain FAILED (${fail.length}): ${fail.join(", ")}`);
  process.exit(1);
}
console.log(`smoke-json-for-brain OK — ${pass} checks passed`);
