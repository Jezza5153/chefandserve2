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
assert("at least 21 tools registered", tools.length >= 21, `got ${tools.length}`);

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
assert("hours.send_reminder present (outbound)", byName.get("hours.send_reminder")?.risk === "outbound");
assert("hours.reject present (financial)", byName.get("hours.reject")?.risk === "financial");
assert("placements.propose present (outbound)", byName.get("placements.propose")?.risk === "outbound");
assert("shifts.open_soon present (read)", byName.get("shifts.open_soon")?.risk === "read");
assert("insights.leaderboards present (read)", byName.get("insights.leaderboards")?.risk === "read");
assert("integrations.health present (read)", byName.get("integrations.health")?.risk === "read");
assert("chefs.enrich_from_cv present (self)", byName.get("chefs.enrich_from_cv")?.risk === "self");
assert("shifts.interested_chefs present (read)", byName.get("shifts.interested_chefs")?.risk === "read");
assert("chefs.reachability present (read)", byName.get("chefs.reachability")?.risk === "read");
assert("chefs.pending_cv_suggestions present (read)", byName.get("chefs.pending_cv_suggestions")?.risk === "read");
assert("board.recent present (read)", byName.get("board.recent")?.risk === "read");
assert("reminders.create present (self, no confirm)", byName.get("reminders.create")?.risk === "self");
assert("reminders.list present (read)", byName.get("reminders.list")?.risk === "read");
assert("memory.remember present (self)", byName.get("memory.remember")?.risk === "self");
assert("memory.list present (read)", byName.get("memory.list")?.risk === "read");
assert("chefs.list_profile_changes present (read)", byName.get("chefs.list_profile_changes")?.risk === "read");
assert("chefs.approve_profile_change present (outbound)", byName.get("chefs.approve_profile_change")?.risk === "outbound");
assert("chefs.reject_profile_change present (outbound)", byName.get("chefs.reject_profile_change")?.risk === "outbound");
assert("chefs.send_availability_reminder present (outbound)", byName.get("chefs.send_availability_reminder")?.risk === "outbound");
assert("chefs.work_summary present (read)", byName.get("chefs.work_summary")?.risk === "read");
assert("chefs.feedback present (read)", byName.get("chefs.feedback")?.risk === "read");
assert("chefs.trends present (read)", byName.get("chefs.trends")?.risk === "read");
assert("chefs.profile_completeness present (read)", byName.get("chefs.profile_completeness")?.risk === "read");
assert("clients.history present (read)", byName.get("clients.history")?.risk === "read");
assert("planner.cockpit present (read)", byName.get("planner.cockpit")?.risk === "read");
assert("shifts.suggest_chefs present (read)", byName.get("shifts.suggest_chefs")?.risk === "read");
assert("chefs.semantic_search present (read)", byName.get("chefs.semantic_search")?.risk === "read");
assert("clients.semantic_search present (read)", byName.get("clients.semantic_search")?.risk === "read");
assert("shifts.margin present (read)", byName.get("shifts.margin")?.risk === "read");
assert("contacts.timeline present (read)", byName.get("contacts.timeline")?.risk === "read");
assert("roster.overview present (read)", byName.get("roster.overview")?.risk === "read");
assert("chefs.intel_snapshot present (read)", byName.get("chefs.intel_snapshot")?.risk === "read");
assert("clients.intel_snapshot present (read)", byName.get("clients.intel_snapshot")?.risk === "read");
assert("match.intel present (read)", byName.get("match.intel")?.risk === "read");

// Wave B1 — planner-scoped registry: only tools within the planner's RBAC set reach the model.
{
  const { buildScopedRegistry } = await import("@/lib/ai/tools/index");
  const { ROLE_GRANTS } = await import("@/lib/rbac/catalog");
  const plannerPerms: ReadonlySet<string> = new Set(ROLE_GRANTS.planner ?? []);
  const scoped = new Set(buildScopedRegistry(plannerPerms).specs().map((s) => s.name));
  assert("planner scope: shifts.suggest_chefs IN", scoped.has("shifts.suggest_chefs"));
  assert("planner scope: planner.cockpit IN", scoped.has("planner.cockpit"));
  assert("planner scope: placements.propose IN", scoped.has("placements.propose"));
  assert("planner scope: hours.approve OUT", !scoped.has("hours.approve"));
  assert("planner scope: payroll.read OUT", !scoped.has("payroll.read"));
  assert("planner scope: feedback.review OUT", !scoped.has("feedback.review"));
  assert("planner scope: inboxes.grant_access OUT", !scoped.has("inboxes.grant_access"));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
