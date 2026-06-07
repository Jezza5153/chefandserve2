/**
 * AI tool registry well-formedness — every real tool is uniquely named, its permission
 * maps to a real RBAC catalog key, its risk tier is valid, and confirm-gated tools carry
 * a describeAction. Pure metadata checks; no DB query runs (run() is never called).
 * Imports the real tool chain (which loads env.ts at init), so pass --env-file:
 *   npx tsx --env-file=.env.local scripts/smoke-ai-tools.mts
 */
const { buildRegistry } = await import("@/lib/ai/tools/index");
const { permKeyExists } = await import("@/lib/rbac/catalog");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log("  ✓", name);
    pass++;
  } else {
    console.log("  ✗", name, detail ? `— ${detail}` : "");
    fail++;
  }
}

const VALID_RISKS = new Set(["read", "self", "outbound", "financial"]);

console.log("=== AI tool registry well-formedness ===\n");

let registry;
try {
  registry = buildRegistry();
  assert("registry builds (unique names)", true);
} catch (e) {
  assert("registry builds (unique names)", false, String(e));
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(1);
}

const tools = registry.list();
assert("at least 3 tools registered", tools.length >= 3, `got ${tools.length}`);

for (const t of tools) {
  assert(`${t.name}: has title + meaningful description`, Boolean(t.title) && t.description.length > 10);
  assert(`${t.name}: valid risk tier (${t.risk})`, VALID_RISKS.has(t.risk));
  if (t.permission) {
    const key = `${t.permission.resource}.${t.permission.action}`;
    assert(`${t.name}: permission "${key}" exists in RBAC catalog`, permKeyExists(key));
  }
  if (t.risk === "outbound" || t.risk === "financial") {
    assert(`${t.name}: confirm-gated → has describeAction`, typeof t.describeAction === "function");
  }
}

const specs = registry.specs();
assert("specs: one per tool", specs.length === tools.length);
assert("specs: every spec has a description", specs.every((s) => s.description.length > 0));

const byName = new Map(tools.map((t) => [t.name, t]));
assert("business.overview present (read)", byName.get("business.overview")?.risk === "read");
assert("hours.list_awaiting_approval present (read)", byName.get("hours.list_awaiting_approval")?.risk === "read");
assert("hours.approve present (financial)", byName.get("hours.approve")?.risk === "financial");

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
