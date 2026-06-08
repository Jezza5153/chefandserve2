/**
 * AI safety eval — proves the REAL registered tools are correctly gated, by running
 * each through the executor on the deny/confirm paths only. Those checks short-circuit
 * BEFORE the handler runs, so no DB query fires. Codifies the guarantees as a
 * regression suite:
 *   - every tool with a permission denies an actor who lacks it
 *   - every outbound/financial tool HAS a permission and demands confirmation
 *
 * Imports the real tool chain (loads env.ts), so pass --env-file:
 *   npx tsx --env-file=.env.local scripts/smoke-ai-safety.mts
 */
import type { AiActor, AiAuditEvent, ToolContext } from "@/lib/ai/types";

const { buildRegistry } = await import("@/lib/ai/tools/index");
const { executeTool } = await import("@/lib/ai/runtime/execute");
const { CATALOG } = await import("@/lib/rbac/catalog");

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

const SECRET = "safety-eval-secret-please-ignore-0123456789";
const sink = async (_e: AiAuditEvent) => {};
const opts = { auditSink: sink, confirmSecret: SECRET };

const base = { requestedByUserId: "u", requestedByRole: "owner", paServiceUserId: "u" };
const noPerms: AiActor = { ...base, effectivePerms: new Set<string>() };
const allPerms: AiActor = { ...base, effectivePerms: new Set(CATALOG.map((p) => p.key)) };
const ctx = (actor: AiActor): ToolContext => ({ actor, channel: "dashboard" });

// Per-tool valid sample input so validation passes and we actually reach the
// permission/confirm gate (which is what this eval tests). A missing entry falls back
// to {} — fine for no-arg tools; a tool with required fields would fail loudly here,
// flagging that its sample needs adding.
const SAMPLE: Record<string, unknown> = {
  "hours.approve": { hoursId: "x" },
  "hours.reject": { hoursId: "x", reason: "test reden" },
  "hours.send_reminder": { hoursId: "x" },
  "placements.propose": { shiftId: "x", chefId: "y" },
  "placements.confirm": { placementId: "x" },
  "placements.cancel": { placementId: "x" },
  "email.send": { to: "test@example.nl", subject: "Test", body: "Hallo" },
  "chefs.approve_profile_change": { requestId: "x" },
  "chefs.reject_profile_change": { requestId: "x" },
  "chefs.work_summary": { chefId: "x" },
  "chefs.feedback": { chefId: "x" },
  "chefs.trends": { chefId: "x" },
  "chefs.profile_completeness": { chefId: "x" },
  "clients.history": { clientId: "x" },
  "shifts.suggest_chefs": { shiftId: "x" },
  "chefs.semantic_search": { query: "test" },
  "clients.semantic_search": { query: "test" },
  "shifts.margin": { shiftId: "x" },
  "contacts.timeline": { targetType: "chef", targetId: "x" },
  "knowledge.search": { query: "test" },
};
const sampleFor = (name: string): unknown => SAMPLE[name] ?? {};

console.log("=== AI safety eval (real tools through the gate) ===\n");

const registry = buildRegistry();
for (const tool of registry.list()) {
  if (tool.permission) {
    const key = `${tool.permission.resource}.${tool.permission.action}`;
    const denied = await executeTool(tool, sampleFor(tool.name), ctx(noPerms), opts);
    assert(`${tool.name}: denied without "${key}"`, denied.status === "denied", `got ${denied.status}`);
  }
  if (tool.risk === "outbound" || tool.risk === "financial") {
    assert(`${tool.name}: outbound/financial tool has a permission`, tool.permission !== null);
    const gated = await executeTool(tool, sampleFor(tool.name), ctx(allPerms), opts);
    assert(`${tool.name}: demands confirmation even with full rights`, gated.status === "needs_confirmation", `got ${gated.status}`);
  }
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
