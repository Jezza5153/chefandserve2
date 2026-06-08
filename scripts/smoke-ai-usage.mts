/**
 * AI usage-tally smoke — the pure aggregation + cost math and the brain's usage capture,
 * proven without a DB (the pure helpers) and with a fake transport (the brain). No network.
 *   npx tsx --env-file=.env.local scripts/smoke-ai-usage.mts
 * (env-file because importing the read-model loads config/env at module init.)
 */
import type { OpenAiTransport, TokenUsage } from "@/lib/ai/runtime/openai-brain";

const { aggregateUsage, computeCost, dayKey } = await import("@/lib/ai/read-model/ai-usage");
const { createOpenAiBrain } = await import("@/lib/ai/runtime/openai-brain");

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

console.log("=== AI usage tally smoke ===\n");

console.log("── aggregation (per-day, per-model) ──");
{
  const bag = {
    days: {
      "2026-06-01": { "gpt-5.4": { prompt: 100, completion: 50, turns: 2 } },
      "2026-05-01": { "gpt-5.4": { prompt: 999, completion: 999, turns: 9 } },
      "2026-06-05": { "gpt-4o": { prompt: 10, completion: 5, turns: 1 } },
    },
  };
  const agg = aggregateUsage(bag, "2026-05-15");
  assert("excludes days before the cutoff", agg.prompt === 110 && agg.completion === 55, `got ${agg.prompt}/${agg.completion}`);
  assert("counts turns in-window", agg.turns === 3, `got ${agg.turns}`);
  assert("collects the models seen", agg.models.has("gpt-5.4") && agg.models.has("gpt-4o"));
  assert("empty bag → zero", aggregateUsage({ days: {} }, "2026-01-01").prompt === 0);
}

console.log("\n── cost math ──");
{
  assert("null when unpriced", computeCost(1000, 1000, null) === null);
  const c = computeCost(1_000_000, 2_000_000, { inputPer1M: 3, outputPer1M: 10 });
  assert("priced: 1M in @3 + 2M out @10 = 23", c === 23, `got ${c}`);
  assert("zero usage → 0 cost", computeCost(0, 0, { inputPer1M: 3, outputPer1M: 10 }) === 0);
}

console.log("\n── dayKey ──");
{
  assert("yyyy-mm-dd format", /^\d{4}-\d{2}-\d{2}$/.test(dayKey(new Date("2026-06-08T12:00:00Z"))));
  assert("UTC date", dayKey(new Date("2026-06-08T23:30:00Z")) === "2026-06-08");
}

console.log("\n── brain captures usage via onUsage ──");
{
  let captured: TokenUsage | null = null;
  const transport: OpenAiTransport = async () => ({
    status: 200,
    json: { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 } },
  });
  const brain = createOpenAiBrain({ apiKey: "sk-test", model: "gpt-4o", transport, onUsage: (u) => (captured = u) });
  await brain.plan({ messages: [{ role: "user", content: "hi" }], tools: [] });
  const got = captured as TokenUsage | null;
  assert("usage forwarded to onUsage", got?.promptTokens === 12 && got?.completionTokens === 7, JSON.stringify(got));
  assert("total tokens captured", got?.totalTokens === 19);
}

console.log("\n── brain without a usage block doesn't crash ──");
{
  let called = false;
  const transport: OpenAiTransport = async () => ({ status: 200, json: { choices: [{ message: { content: "ok" } }] } });
  const brain = createOpenAiBrain({ apiKey: "sk-test", model: "gpt-4o", transport, onUsage: () => (called = true) });
  const step = await brain.plan({ messages: [], tools: [] });
  assert("no usage → onUsage not fired, no throw", !called && step.kind === "final");
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
