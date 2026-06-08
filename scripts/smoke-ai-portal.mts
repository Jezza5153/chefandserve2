/**
 * Portal-assistant smoke — safety invariants for the CHEF + KLANT assistants.
 *   npx tsx --env-file=.env.local scripts/smoke-ai-portal.mts
 *
 * Static (key-free): every portal tool is read-only (`risk:'read'`, `permission:null`) and
 * takes NO entity-id input — so the model can never steer it to another tenant (the attack
 * vector). Live (needs DB): build an actor for a REAL chef/klant and run each tool through the
 * executor; the read-model keys off the actor subject, so results are that tenant's own data.
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

const { buildChefRegistry, buildClientRegistry } = await import("@/lib/ai/tools/portal-index");
const { executeTool } = await import("@/lib/ai/runtime/execute");

const dbUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const neonSql = dbUrl ? (await import("@neondatabase/serverless")).neon(dbUrl) : null;

async function checkPersona(label: string, kind: "chef" | "client", reg: ReturnType<typeof buildChefRegistry>, entityId: string | null) {
  const tools = reg.list();
  console.log(`\n── ${label} tools: read-only + own-scoped ──`);
  assert(`${label} registry has tools`, tools.length >= 3, `${tools.length}`);
  for (const t of tools) {
    assert(`${t.name}: risk=read`, t.risk === "read");
    assert(`${t.name}: permission=null`, t.permission === null);
    const parsed = t.input.safeParse({ chefId: "evil", clientId: "evil", entityId: "evil" });
    assert(`${t.name}: ignores injected ids`, parsed.success && !("chefId" in (parsed.data as object)) && !("clientId" in (parsed.data as object)));
  }

  console.log(`\n── ${label} live: scoped execution ──`);
  if (!entityId) {
    console.log(`  ⊘ no DATABASE_URL / no ${label} in DB — skipping live.`);
    skip++;
    return;
  }
  const ctx = {
    actor: { requestedByUserId: "smoke", requestedByRole: kind, paServiceUserId: "smoke", effectivePerms: new Set<string>(), subject: { kind, entityId } },
    channel: "dashboard" as const,
  };
  const opts = { auditSink: async () => {}, confirmSecret: "x".repeat(32) };
  for (const t of tools) {
    const res = await executeTool(t, {}, ctx, opts);
    assert(`${t.name}: runs ok for a real ${label}`, res.status === "ok", res.status === "ok" ? "" : JSON.stringify(res).slice(0, 120));
  }
  const noSubject = { ...ctx, actor: { ...ctx.actor, subject: undefined } };
  const res = await executeTool(tools[0], {}, noSubject, opts);
  assert(`${label}: tool errors cleanly with no subject`, res.status === "error");
}

const chefId = neonSql ? ((await neonSql`SELECT id FROM chefs WHERE deleted_at IS NULL LIMIT 1`) as Array<{ id: string }>)[0]?.id ?? null : null;
const clientId = neonSql ? ((await neonSql`SELECT id FROM clients WHERE deleted_at IS NULL LIMIT 1`) as Array<{ id: string }>)[0]?.id ?? null : null;

await checkPersona("chef", "chef", buildChefRegistry(), chefId);
await checkPersona("klant", "client", buildClientRegistry(), clientId);

console.log(`\n=== ${pass} passed, ${fail} failed, ${skip} skipped ===`);
if (fail > 0) process.exit(1);
process.exit(0);
