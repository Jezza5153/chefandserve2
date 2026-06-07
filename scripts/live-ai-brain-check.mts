/**
 * LIVE check — one real OpenAI call to prove the key + model + tool-calling wiring work.
 * Does NOT execute any tool (no DB touch): it only asks the brain to PLAN a step and
 * checks it chose a tool. Throwaway / not part of the gate.
 *   npx tsx --env-file=.env.local scripts/live-ai-brain-check.mts
 */
import type { ToolSpec } from "@/lib/ai/tools/registry";

const { env } = await import("@/lib/env");
const { aiModel } = await import("@/lib/ai/config");
const { createOpenAiBrain } = await import("@/lib/ai/runtime/openai-brain");
const { buildRegistry } = await import("@/lib/ai/tools/index");

if (!env.OPENAI_API_KEY) {
  console.error("✗ OPENAI_API_KEY not set in this env.");
  process.exit(1);
}

const tools: ToolSpec[] = buildRegistry().specs();
const brain = createOpenAiBrain({ apiKey: env.OPENAI_API_KEY, model: aiModel() });

console.log(`Model: ${aiModel()}  ·  ${tools.length} tools available`);
console.log("Vraag: “Hoeveel urenregels wachten op mijn goedkeuring?”\n");

try {
  const step = await brain.plan({
    messages: [{ role: "user", content: "Hoeveel urenregels wachten op mijn goedkeuring?" }],
    tools,
  });
  console.log("Brain step:", JSON.stringify(step));
  if (step.kind === "tool_call") {
    console.log(`\n✓ LIVE OK — the model reached OpenAI and chose tool: ${step.tool}`);
  } else {
    console.log(`\n✓ LIVE OK — model answered directly (no tool): ${step.text.slice(0, 160)}`);
  }
} catch (e) {
  console.error("\n✗ LIVE call failed:", e instanceof Error ? e.message : String(e));
  console.error("(if it's a model-not-found error, adjust OPENAI_MODEL)");
  process.exit(1);
}
