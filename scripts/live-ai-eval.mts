/**
 * LIVE eval suite — does the real model route realistic owner questions to the right tool?
 *
 * Uses the REAL 21-tool specs + the REAL system prompt, but only the PLANNING step: one
 * OpenAI call per case, no tool execution, no DB. It's the behaviour regression-check to run
 * whenever the system prompt, playbook, or tool descriptions change:
 *   npx tsx --env-file=.env.local scripts/live-ai-eval.mts
 *
 * Manual (needs OPENAI_API_KEY + costs ~1 call/case); not part of the key-free gate.
 */
import type { ToolSpec } from "@/lib/ai/tools/registry";

const { env } = await import("@/lib/env");
const { aiModel } = await import("@/lib/ai/config");
const { createOpenAiBrain } = await import("@/lib/ai/runtime/openai-brain");
const { buildRegistry } = await import("@/lib/ai/tools/index");

if (!env.OPENAI_API_KEY) {
  console.error("✗ OPENAI_API_KEY not set — set it (via --env-file=.env.local) to run the eval.");
  process.exit(1);
}

const tools: ToolSpec[] = buildRegistry().specs();
const brain = createOpenAiBrain({ apiKey: env.OPENAI_API_KEY, model: aiModel() });

type EvalCase = { q: string; expect: string | string[] };

// Each case: the owner's phrasing → the tool we expect the assistant to reach for first.
// Arrays mean "any of these is acceptable" (genuinely ambiguous routings).
const CASES: EvalCase[] = [
  { q: "hoeveel actieve chefs heb ik", expect: "business.overview" },
  { q: "hoe staan we ervoor qua omzet en marge deze maand", expect: "business.overview" },
  { q: "wat zijn de loonkosten", expect: "business.overview" },
  { q: "vertel me over chef Daniel", expect: "chefs.find" },
  { q: "welke chefs kunnen sushi", expect: "chefs.find" },
  { q: "wie is de contactpersoon bij hotel Okura", expect: "clients.find" },
  { q: "welke diensten staan er open komende dagen", expect: ["shifts.open_soon", "shifts.find"] },
  { q: "wat is de status van de dienst bij hotel Okura vrijdag", expect: "shifts.find" },
  { q: "wie heeft z'n uren nog niet goedgekeurd", expect: "hours.list_awaiting_approval" },
  { q: "keur urenregel h123 goed", expect: "hours.approve" },
  { q: "stuur een mail naar jan@hotel.nl dat de dienst van vrijdag rond is", expect: "email.send" },
  { q: "herinner me morgen aan de factuur van Okura", expect: "reminders.create" },
  { q: "wat staat er nog op m'n lijst", expect: "reminders.list" },
  { q: "onthoud dat hotel Okura altijd minstens 2 koks wil", expect: "memory.remember" },
  { q: "wie zijn m'n best beoordeelde chefs", expect: ["insights.leaderboards", "chefs.find"] },
  { q: "draaien alle koppelingen nog", expect: "integrations.health" },
];

let pass = 0;
let fail = 0;
console.log(`Model: ${aiModel()}  ·  ${tools.length} tools  ·  ${CASES.length} cases\n`);

for (const c of CASES) {
  let chosen = "(error)";
  let ok = false;
  try {
    const step = await brain.plan({ messages: [{ role: "user", content: c.q }], tools });
    chosen = step.kind === "tool_call" ? step.tool : `final: ${step.text.slice(0, 40)}…`;
    const expected = Array.isArray(c.expect) ? c.expect : [c.expect];
    ok = step.kind === "tool_call" && expected.includes(step.tool);
  } catch (e) {
    chosen = `error: ${e instanceof Error ? e.message : String(e)}`;
  }
  const want = Array.isArray(c.expect) ? c.expect.join(" | ") : c.expect;
  console.log(`${ok ? "✓" : "✗"} "${c.q}"\n    → ${chosen}${ok ? "" : `   (expected: ${want})`}`);
  if (ok) pass++;
  else fail++;
}

console.log(`\n=== ${pass}/${CASES.length} routed correctly ===`);
if (fail > 0) process.exit(1);
