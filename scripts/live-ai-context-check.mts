/**
 * LIVE multi-turn context check — proves the assistant CARRIES the conversation topic
 * forward instead of re-asking. Reproduces the real bug: after "hoeveel chefs heb ik",
 * a bare follow-up "wie heeft er een email adres" must be understood as ABOUT CHEFS —
 * not answered with a "chefs of klanten?" tegenvraag. Real OpenAI brain + real runAgent
 * loop, but FAKE in-memory chefs.find / clients.find (no DB) so it's safe + cheap.
 *   npx tsx --env-file=.env.local scripts/live-ai-context-check.mts
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

const fakeChefsFind = defineTool({
  name: "chefs.find",
  title: "Chefs opzoeken",
  description:
    "Zoek chefs op naam, stad, specialiteit of segment. Laat de zoekterm leeg voor een lijst. Read-only.",
  risk: "read",
  permission: null,
  input: z.object({ query: z.string().optional(), limit: z.number().int().optional() }),
  run: async () => ({
    data: {
      chefs: [
        { name: "Daniel Berg", email: "daniel@example.nl" },
        { name: "Sofia Ruiz", email: null },
        { name: "Tom de Vries", email: "tom@example.nl" },
      ],
    },
    summary: "3 chefs gevonden.",
  }),
});
// A klanten tool too, so the model COULD wrongly switch — the test is that it doesn't.
const fakeClientsFind = defineTool({
  name: "clients.find",
  title: "Klanten opzoeken",
  description: "Zoek klanten/opdrachtgevers op bedrijfsnaam, contactpersoon of stad. Read-only.",
  risk: "read",
  permission: null,
  input: z.object({ query: z.string().optional() }),
  run: async () => ({ data: { clients: [] }, summary: "Geen klanten." }),
});

const registry = createRegistry([fakeChefsFind, fakeClientsFind]);
const brain = createOpenAiBrain({ apiKey: env.OPENAI_API_KEY, model: aiModel() });

const actor: AiActor = {
  requestedByUserId: "u",
  requestedByRole: "owner",
  paServiceUserId: "u",
  effectivePerms: new Set<string>(),
};
const ctx: ToolContext = { actor, channel: "dashboard" };

console.log(`Model: ${aiModel()}`);
console.log('Beurt 1: "hoeveel chefs heb ik" → "Je hebt nu 8 actieve chefs op de rol."');
console.log('Beurt 2: "wie heeft er een email adres"  (woord "chefs"/"klanten" NIET genoemd)\n');

const outcome = await runAgent({
  brain,
  registry,
  messages: [
    { role: "user", content: "hoeveel chefs heb ik" },
    { role: "assistant", content: "Je hebt nu 8 actieve chefs op de rol." },
    { role: "user", content: "wie heeft er een email adres" },
  ],
  ctx,
  executeOptions: { auditSink: async () => {}, confirmSecret: "x".repeat(32) },
});

const text = outcome.kind === "final" ? outcome.text : "";
const steps = outcome.kind === "final" ? outcome.steps.map((s) => s.tool) : [];
console.log("Outcome:", JSON.stringify({ kind: outcome.kind, text, steps }, null, 2));

const calledChefs = steps.includes("chefs.find");
const calledClients = steps.includes("clients.find");
// Failure signature: stalled with a "chefs of klanten?" tegenvraag and no chef lookup.
const askedChefOrKlant = !calledChefs && /klant/i.test(text) && /chef/i.test(text) && text.includes("?");

const pass = !calledClients && !askedChefOrKlant && (calledChefs || /chef/i.test(text));
if (pass) {
  console.log("\n✓ FIXED — droeg de chef-context mee (chefs.find / chef-antwoord, geen chefs-of-klanten tegenvraag).");
} else if (askedChefOrKlant) {
  console.log("\n✗ STILL BROKEN — vroeg opnieuw 'chefs of klanten?' in plaats van de context te gebruiken.");
  process.exit(1);
} else if (calledClients) {
  console.log("\n✗ WRONG SWITCH — pakte klanten erbij terwijl het gesprek over chefs ging.");
  process.exit(1);
} else {
  console.log("\n⚠ Onverwacht — bekijk de outcome hierboven.");
  process.exit(1);
}
