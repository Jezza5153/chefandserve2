/**
 * Portal-assistant smoke — the safety invariants for the chef (+ later klant) assistant.
 *   npx tsx --env-file=.env.local scripts/smoke-ai-portal.mts
 *
 * Static (key-free): every chef tool is read-only (`risk:'read'`, `permission:null`) and takes
 * NO entity-id input — so the model can never steer it to another chef (the attack vector).
 * Live (needs DB): build a chef actor for a REAL chef and run each tool through the executor;
 * the read-model keys off the actor subject, so results are that chef's own data.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

let pass = 0;
let fail = 0;
let skip = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log("  ✓", name);
    pass++;
  } else {
    console.log("  ✗", name, detail ? `— ${detail}` : "");
    fail++;
  }
}

console.log("=== Portal assistant smoke ===\n");

const { buildChefRegistry } = await import("@/lib/ai/tools/portal-index");
const reg = buildChefRegistry();
const tools = reg.list();

console.log("── chef tools: read-only + own-scoped ──");
assert("chef registry has tools", tools.length >= 3, `${tools.length}`);
for (const t of tools) {
  assert(`${t.name}: risk=read`, t.risk === "read");
  assert(`${t.name}: permission=null (no RBAC gate)`, t.permission === null);
  // the attack vector: can the model pass an id to reach another chef? Empty object schema
  // strips unknown keys, so an injected id never reaches the handler.
  const parsed = t.input.safeParse({ chefId: "evil", clientId: "evil", entityId: "evil" });
  assert(`${t.name}: rejects/ignores injected ids`, parsed.success && !("chefId" in (parsed.data as object)) && !("clientId" in (parsed.data as object)));
}

console.log("\n── live: scoped execution for a real chef ──");
const dbUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!dbUrl) {
  console.log("  ⊘ no DATABASE_URL — skipping live execution.");
  skip++;
} else {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(dbUrl);
  const rows = (await sql`SELECT id FROM chefs WHERE deleted_at IS NULL LIMIT 1`) as Array<{ id: string }>;
  if (rows.length === 0) {
    console.log("  ⊘ no chefs in DB — skipping.");
    skip++;
  } else {
    const chefId = rows[0].id;
    const { executeTool } = await import("@/lib/ai/runtime/execute");
    const ctx = {
      actor: { requestedByUserId: "smoke", requestedByRole: "chef", paServiceUserId: "smoke", effectivePerms: new Set<string>(), subject: { kind: "chef" as const, entityId: chefId } },
      channel: "dashboard" as const,
    };
    const opts = { auditSink: async () => {}, confirmSecret: "x".repeat(32) };
    for (const t of tools) {
      const res = await executeTool(t, {}, ctx, opts);
      assert(`${t.name}: runs ok for a real chef`, res.status === "ok", res.status === "ok" ? "" : JSON.stringify(res).slice(0, 120));
    }
    // a chef tool with NO subject must refuse (defense in depth)
    const noSubjectCtx = { ...ctx, actor: { ...ctx.actor, subject: undefined } };
    const res = await executeTool(tools[0], {}, noSubjectCtx, opts);
    assert("tool errors cleanly when actor has no chef subject", res.status === "error");
  }
}

console.log(`\n=== ${pass} passed, ${fail} failed, ${skip} skipped ===`);
if (fail > 0) process.exit(1);
process.exit(0);
