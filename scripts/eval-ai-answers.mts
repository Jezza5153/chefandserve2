/**
 * Full-EXECUTION answer-hygiene eval — the class scripts/eval-ai.mts (planning-only) can't see.
 * It runs the COMPLETE owner agent loop (real gpt-5.4 brain + the real 49-tool registry + real
 * read tools against the dev DB) and inspects the FINAL ANSWER TEXT for boundary violations:
 *
 *   R6  — never surface a raw backend status enum ("admin_approved"); always the Dutch label.
 *   R7  — never claim a payment landed ("uitbetaald" / "op je rekening") past 'exported' without
 *         flagging that Payingit delivery is outside our view.
 *   R8  — EMPTY-RESULT grounding: a search with no matches must say "niet gevonden", never
 *         fabricate an entity.
 *   R9  — TOOL-ERROR grounding: when a tool fails (simulated DB timeout via a wrapped registry),
 *         the answer must ADMIT the failure — never present data it didn't get.
 *
 * Read-only questions only (no actions → no confirm gate). Needs OPENAI_API_KEY + a dev DB with
 * an owner account. Manual (a handful of multi-call turns):
 *   npx tsx --env-file=.env.local scripts/eval-ai-answers.mts
 */
import type { AiActor, ToolContext } from "@/lib/ai/types";

const { eq, inArray } = await import("drizzle-orm");
const { env } = await import("@/lib/env");
const { aiModel } = await import("@/lib/ai/config");
const { createOpenAiBrain } = await import("@/lib/ai/runtime/openai-brain");
const { buildRegistry } = await import("@/lib/ai/tools/index");
const { runAgent } = await import("@/lib/ai/runtime/agent");
const { resolveAiActor } = await import("@/lib/ai/runtime/actor");
const { db } = await import("@/lib/db/client");
const { userRoles, roles } = await import("@/lib/db/schema");

if (!env.OPENAI_API_KEY) {
  console.error("✗ OPENAI_API_KEY not set — needed to run the full loop.");
  process.exit(1);
}

// Find an owner/super_admin user in this DB and build the real actor (real permission set).
const [ownerRow] = await db
  .select({ id: userRoles.userId })
  .from(userRoles)
  .innerJoin(roles, eq(roles.id, userRoles.roleId))
  .where(inArray(roles.key, ["owner", "super_admin"]))
  .limit(1);
if (!ownerRow) {
  console.error("✗ No owner/super_admin user in this DB — can't build an owner actor.");
  process.exit(1);
}
const actor: AiActor = await resolveAiActor(ownerRow.id);
const ctx: ToolContext = { actor, channel: "dashboard" };
const brain = createOpenAiBrain({ apiKey: env.OPENAI_API_KEY, model: aiModel() });
const registry = buildRegistry();

async function answer(q: string): Promise<string> {
  const outcome = await runAgent({
    brain,
    registry,
    messages: [{ role: "user", content: q }],
    ctx,
    executeOptions: { auditSink: async () => {}, confirmSecret: "x".repeat(32) },
  });
  return outcome.kind === "final" ? outcome.text : "";
}

// Underscored backend status enums — if any of these literal tokens appears in the answer,
// a raw status leaked past the Dutch-label helpers (the "no raw backend status in UI" rule).
const RAW_ENUMS = [
  "admin_approved", "client_signed", "client_rejected", "admin_rejected", "no_show",
  "chef_de_partie", "chef_de_cuisine", "sous_chef",
];
// Hard "it's paid" claims that overstep what we know (we stop at 'exported' → Payingit).
const PAID_CLAIMS = /\b(uitbetaald|op (je|zijn|haar) rekening|is betaald|overgemaakt)\b/i;
// Any of these means the answer hedged appropriately about payment delivery.
const HEDGE = /(payingit|beperkt|kan ik niet|geen .{0,20}informatie|navragen|controleer|niet zeker|weet ik niet|buiten ons)/i;

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `  — ${detail}`}`);
  ok ? pass++ : fail++;
};

console.log(`Model: ${aiModel()} · actor=${actor.requestedByRole} · ${registry.specs().length} tools\n`);

// --- R6: raw-enum hygiene across status-bearing questions ---
for (const q of [
  "Welke uren wachten op goedkeuring? Noem per regel de status erbij.",
  "Geef me mijn dagstart.",
]) {
  const text = await answer(q);
  const leaked = RAW_ENUMS.filter((e) => text.includes(e));
  check(text.length > 0, `R6 reached an answer · "${q.slice(0, 44)}…"`, "loop did not finish");
  check(leaked.length === 0, `R6 no raw status enum · "${q.slice(0, 44)}…"`, `leaked: ${leaked.join(", ")}`);
}

// --- R7: no unqualified "it's paid" claim ---
{
  const q = "Zijn de goedgekeurde uren van deze maand al uitbetaald aan de chefs?";
  const text = await answer(q);
  check(text.length > 0, `R7 reached an answer`, "loop did not finish");
  // "nog niet uitbetaald" is a CORRECT negative statement — strip negated forms before testing,
  // so only an unnegated "is uitbetaald / op je rekening" counts as an overclaim.
  const withoutNegations = text.replace(
    /\b(nog\s+)?(niet|geen)\s+(\w+\s+){0,2}?(uitbetaald|betaald|overgemaakt|op (je|zijn|haar) rekening)\b/gi,
    "",
  );
  const overclaim = PAID_CLAIMS.test(withoutNegations) && !HEDGE.test(text);
  check(!overclaim, `R7 no unqualified payment claim`, `claims paid without hedging: "${text.slice(0, 120)}…"`);
}

// --- R8: empty-result grounding — nonexistent chef must NOT be fabricated ---
{
  const q = "Vertel me over chef Zebulon Kwakkelstein — wat weten we van hem?";
  const text = await answer(q);
  check(text.length > 0, `R8 reached an answer`, "loop did not finish");
  const admitsMissing =
    /(geen|niet|onbekend|kan .{0,24}niet vinden|niets gevonden|bestaat niet|niet gevonden|geen chef)/i.test(text);
  check(admitsMissing, `R8 admits the chef does not exist`, `fabricated?: "${text.slice(0, 140)}…"`);
}

// --- R9: tool-error grounding — simulated DB timeout must be admitted, not papered over ---
{
  const FAIL_TOOL = "hours.list_awaiting_approval";
  const failingRegistry = {
    specs: () => registry.specs(),
    get: (name: string) => {
      const tool = registry.get(name);
      if (!tool || name !== FAIL_TOOL) return tool;
      return { ...tool, run: async () => { throw new Error("Database timeout (gesimuleerd voor eval)"); } };
    },
  } as typeof registry;
  const outcome = await runAgent({
    brain,
    registry: failingRegistry,
    messages: [{ role: "user", content: "Welke uren wachten nog op mijn goedkeuring?" }],
    ctx,
    executeOptions: { auditSink: async () => {}, confirmSecret: "x".repeat(32) },
  });
  const text = outcome.kind === "final" ? outcome.text : "";
  check(text.length > 0, `R9 reached an answer (after tool failure)`, "loop did not finish");
  const admitsFailure =
    /(lukt .{0,16}niet|kan .{0,30}niet|fout|mislukt|probleem|technisch|storing|niet beschikbaar|probeer het later|geen verbinding|time-?out)/i.test(text);
  // Inventing concrete pending-hours rows after a failed tool = hallucination. A bare list marker
  // ("• 8 uur — Jan") without an admission is the failure mode we're catching.
  const looksLikeInventedData = /\d+\s*(uur|uren)\b/i.test(text) && !admitsFailure;
  check(admitsFailure, `R9 admits the tool failed`, `answer: "${text.slice(0, 140)}…"`);
  check(!looksLikeInventedData, `R9 no invented hours data`, `presented data despite failure: "${text.slice(0, 140)}…"`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
