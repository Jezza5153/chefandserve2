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

/**
 * Per-tool sample inputs for portal tools that take a NON-tenant id (e.g. onze.dienst_detail
 * needs a shiftId). `parse` is a static placeholder so the schema-parse check succeeds; `run`
 * is real seed data (or null → skip the run-check when there's no seed). Tenant scoping always
 * comes from ctx.subject, never from these inputs.
 */
type ToolSample = { parse: Record<string, unknown>; run: Record<string, unknown> | null };

async function checkPersona(
  label: string,
  kind: "chef" | "client",
  reg: ReturnType<typeof buildChefRegistry>,
  entityId: string | null,
  samples: Record<string, ToolSample> = {},
) {
  const tools = reg.list();
  console.log(`\n── ${label} tools: read-only + own-scoped ──`);
  assert(`${label} registry has tools`, tools.length >= 3, `${tools.length}`);
  for (const t of tools) {
    assert(`${t.name}: risk=read`, t.risk === "read");
    assert(`${t.name}: permission=null`, t.permission === null);
    // The schema must never ACCEPT a tenant id (chefId/clientId/entityId) — supply the
    // tool's own required fields (parse placeholder) so the parse succeeds, then assert the
    // tenant ids were stripped.
    const parsed = t.input.safeParse({ ...(samples[t.name]?.parse ?? {}), chefId: "evil", clientId: "evil", entityId: "evil" });
    assert(
      `${t.name}: ignores injected ids`,
      parsed.success && !("chefId" in (parsed.data as object)) && !("clientId" in (parsed.data as object)) && !("entityId" in (parsed.data as object)),
    );
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
    const sample = samples[t.name];
    // A sample-requiring tool with no seed data can't be run-checked — skip cleanly.
    if (sample && sample.run === null) {
      console.log(`  ⊘ ${t.name}: no seed data — skipping run.`);
      skip++;
      continue;
    }
    const res = await executeTool(t, sample?.run ?? {}, ctx, opts);
    assert(`${t.name}: runs ok for a real ${label}`, res.status === "ok", res.status === "ok" ? "" : JSON.stringify(res).slice(0, 120));
  }
  const noSubject = { ...ctx, actor: { ...ctx.actor, subject: undefined } };
  const res = await executeTool(tools[0], {}, noSubject, opts);
  assert(`${label}: tool errors cleanly with no subject`, res.status === "error");
}

const chefId = neonSql ? ((await neonSql`SELECT id FROM chefs WHERE deleted_at IS NULL LIMIT 1`) as Array<{ id: string }>)[0]?.id ?? null : null;

// Prefer a klant that HAS a shift, so onze.dienst_detail can be run-checked end-to-end.
const klantWithShift = neonSql
  ? ((await neonSql`SELECT c.id AS client_id, s.id AS shift_id FROM clients c JOIN shifts s ON s.client_id = c.id WHERE c.deleted_at IS NULL LIMIT 1`) as Array<{ client_id: string; shift_id: string }>)[0] ?? null
  : null;
const clientId =
  klantWithShift?.client_id ??
  (neonSql ? ((await neonSql`SELECT id FROM clients WHERE deleted_at IS NULL LIMIT 1`) as Array<{ id: string }>)[0]?.id ?? null : null);

const klantSamples: Record<string, ToolSample> = {
  "onze.dienst_detail": {
    parse: { shiftId: "placeholder" },
    run: klantWithShift ? { shiftId: klantWithShift.shift_id } : null,
  },
};

await checkPersona("chef", "chef", buildChefRegistry(), chefId);
await checkPersona("klant", "client", buildClientRegistry(), clientId, klantSamples);

// IDOR guard: onze.dienst_detail must REFUSE a shift owned by another klant.
if (neonSql && klantWithShift) {
  const { clientShiftDetail } = await import("@/lib/ai/read-model/client-shift-detail");
  const foreign = ((await neonSql`SELECT id FROM shifts WHERE client_id IS NOT NULL AND client_id <> ${klantWithShift.client_id} LIMIT 1`) as Array<{ id: string }>)[0];
  if (foreign) {
    console.log("\n── klant IDOR: onze.dienst_detail rejects a foreign shift ──");
    const leaked = await clientShiftDetail(klantWithShift.client_id, foreign.id);
    assert("onze.dienst_detail: foreign shift returns null (no cross-klant leak)", leaked === null, leaked ? JSON.stringify(leaked).slice(0, 120) : "");
  } else {
    console.log("\n  ⊘ only one klant has shifts — skipping cross-klant IDOR check.");
    skip++;
  }
}

console.log(`\n=== ${pass} passed, ${fail} failed, ${skip} skipped ===`);
if (fail > 0) process.exit(1);
process.exit(0);
