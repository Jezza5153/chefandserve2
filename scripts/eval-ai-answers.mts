/**
 * Full-EXECUTION answer-hygiene eval — the class scripts/eval-ai.mts (planning-only) can't see.
 * It runs the COMPLETE owner agent loop (real gpt-5.4 brain + the real 49-tool registry + real
 * read tools against the dev DB) and inspects the FINAL ANSWER TEXT for boundary violations:
 *
 *   R6  — never surface a raw backend status enum ("admin_approved"); always the Dutch label.
 *   R7  — never claim a payment landed ("uitbetaald" / "op je rekening") past 'exported' without
 *         flagging that Payingit delivery is outside our view.
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
  const overclaim = PAID_CLAIMS.test(text) && !HEDGE.test(text);
  check(!overclaim, `R7 no unqualified payment claim`, `claims paid without hedging: "${text.slice(0, 120)}…"`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
