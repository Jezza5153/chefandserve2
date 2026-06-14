/**
 * LIVE portal eval — does the real model route realistic CHEF + KLANT questions to the right
 * scoped tool? Uses the real portal registries + persona prompts, PLANNING step only (one
 * OpenAI call per case, no execution, no DB). Run when a portal prompt/tool description changes:
 *   npx tsx --env-file=.env.local scripts/live-ai-portal-eval.mts
 * Manual (needs OPENAI_API_KEY); not part of the key-free gate.
 */
import type { ToolSpec } from "@/lib/ai/tools/registry";

const { env } = await import("@/lib/env");
const { aiModel } = await import("@/lib/ai/config");
const { createOpenAiBrain } = await import("@/lib/ai/runtime/openai-brain");
const { CHEF_SYSTEM_PROMPT, CLIENT_SYSTEM_PROMPT } = await import("@/lib/ai/runtime/portal-prompts");
const { buildChefRegistry, buildClientRegistry } = await import("@/lib/ai/tools/portal-index");

if (!env.OPENAI_API_KEY) {
  console.error("✗ OPENAI_API_KEY not set — set it (via --env-file=.env.local) to run the eval.");
  process.exit(1);
}

type EvalCase = { q: string; expect: string | string[] };

const CHEF_CASES: EvalCase[] = [
  { q: "wanneer werk ik?", expect: "mijn.diensten" },
  { q: "heb ik nog voorstellen openstaan?", expect: "mijn.diensten" },
  { q: "welke uren moet ik nog invullen?", expect: "mijn.uren" },
  { q: "hoeveel krijg ik nog uitbetaald?", expect: "mijn.uren" },
  { q: "is mijn profiel compleet of mis ik nog iets?", expect: "mijn.profiel" },
];

const KLANT_CASES: EvalCase[] = [
  { q: "wie komt er deze week werken?", expect: "onze.diensten" },
  { q: "welke uren moet ik nog tekenen?", expect: "onze.uren" },
  { q: "hoeveel hebben we de afgelopen maand besteed?", expect: "onze.uren" },
  { q: "staan er nog aanvragen open?", expect: "onze.aanvragen" },
  { q: "welke chefs wachten op mijn feedback?", expect: "onze.aanvragen" },
  // dienst_detail: needs a shiftId, so resolving via onze.diensten first is also acceptable.
  { q: "wie staat er op mijn dienst van zaterdag en is de chef al bevestigd?", expect: ["onze.dienst_detail", "onze.diensten"] },
];

async function runPersona(label: string, systemPrompt: string, tools: ToolSpec[], cases: EvalCase[]) {
  const brain = createOpenAiBrain({ apiKey: env.OPENAI_API_KEY!, model: aiModel(), systemPrompt });
  let pass = 0;
  console.log(`\n=== ${label} · ${tools.length} tools · ${cases.length} cases ===`);
  for (const c of cases) {
    let chosen = "(error)";
    let ok = false;
    try {
      const step = await brain.plan({ messages: [{ role: "user", content: c.q }], tools });
      // Parallel-aware (the brain batches independent tools into a `tool_calls` step
      // since #82) — mirror the owner eval's any-of handling.
      const called =
        step.kind === "tool_calls"
          ? step.calls.map((tc) => tc.tool)
          : step.kind === "tool_call"
            ? [step.tool]
            : [];
      chosen = called.length ? called.join(", ") : "final (no tool)";
      const expected = Array.isArray(c.expect) ? c.expect : [c.expect];
      ok = called.some((t) => expected.includes(t));
    } catch (e) {
      chosen = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
    console.log(`${ok ? "✓" : "✗"} "${c.q}" → ${chosen}${ok ? "" : `  (expected ${Array.isArray(c.expect) ? c.expect.join("|") : c.expect})`}`);
    if (ok) pass++;
  }
  return { pass, total: cases.length };
}

const chef = await runPersona("CHEF", CHEF_SYSTEM_PROMPT, buildChefRegistry().specs(), CHEF_CASES);
const klant = await runPersona("KLANT", CLIENT_SYSTEM_PROMPT, buildClientRegistry().specs(), KLANT_CASES);

const pass = chef.pass + klant.pass;
const total = chef.total + klant.total;
console.log(`\n=== ${pass}/${total} routed correctly ===`);
if (pass < total) process.exit(1);
