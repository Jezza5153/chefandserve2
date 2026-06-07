/**
 * LIVE end-to-end loop check — proves the agent loop now ANSWERS a data question instead
 * of looping to "maximum aantal stappen". Real OpenAI brain, real runAgent loop, real
 * toolMessage feedback — but a FAKE in-memory tool (no DB) so it's safe + cheap (2 calls).
 *   npx tsx --env-file=.env.local scripts/live-ai-loop-check.mts
 */
import type { AiActor, ToolContext } from "@/lib/ai/types";

const { z } = await import("zod");
const { env } = await import("@/lib/env");
const { aiModel } = await import("@/lib/ai/config");
const { createOpenAiBrain } = await import("@/lib/ai/runtime/openai-brain");
const { defineTool, createRegistry } = await import("@/lib/ai/tools/registry");
const { runAgent } = await import("@/lib/ai/runtime/agent");

if (!env.OPENAI_API_KEY) {
  console.error("✗ OPENAI_API_KEY not set in this env.");
  process.exit(1);
}

const fakeOverview = defineTool({
  name: "business.overview",
  title: "Bedrijfsoverzicht",
  description: "Actueel bedrijfsoverzicht: aantal actieve chefs, omzet en bezetting.",
  risk: "read",
  permission: null,
  input: z.object({}),
  run: async () => ({
    // activeChefs lives ONLY in data — exactly the shape that used to make the loop spin.
    data: { activeChefs: 12, workedHours: 320, money: { month: { revenueCents: 1_234_500 } } },
    summary: "Deze maand: omzet €12.345,00, bezetting 8/10.",
  }),
});
const registry = createRegistry([fakeOverview]);
const brain = createOpenAiBrain({ apiKey: env.OPENAI_API_KEY, model: aiModel() });

const actor: AiActor = {
  requestedByUserId: "u",
  requestedByRole: "owner",
  paServiceUserId: "u",
  effectivePerms: new Set<string>(),
};
const ctx: ToolContext = { actor, channel: "dashboard" };

console.log(`Model: ${aiModel()}`);
console.log('Vraag: "hoeveel chefs heb ik"\n');

const outcome = await runAgent({
  brain,
  registry,
  messages: [{ role: "user", content: "hoeveel chefs heb ik" }],
  ctx,
  executeOptions: { auditSink: async () => {}, confirmSecret: "x".repeat(32) },
});

console.log("Outcome:", JSON.stringify(outcome.kind === "final" ? { kind: outcome.kind, text: outcome.text, steps: outcome.steps.length } : outcome, null, 2));

if (outcome.kind === "final" && /12/.test(outcome.text)) {
  console.log("\n✓ FIXED — the loop fetched the data and answered with the count (no 'maximum aantal stappen').");
} else if (outcome.kind === "final") {
  console.log("\n⚠ Answered, but the count (12) wasn't in the text — inspect above.");
  process.exit(1);
} else {
  console.log("\n✗ Did not reach a final answer.");
  process.exit(1);
}
