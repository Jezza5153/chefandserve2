/**
 * Compliance hard-gate (P3a) — pure blocker logic. evaluateChefBlockers is the single
 * source of truth shared by the chef-detail verdict card AND assertChefDeployable, so
 * this locks: only status/ID/payroll-identity HARD-block; soft "almost" signals never do.
 * Pure (no db) → safe as .mts. Run: npx tsx scripts/smoke-chef-deployability-gate.mts
 */
// Dynamic import dodges the tsx .mts static-named-export trap (see the sibling
// smoke-chef-inzetbaarheid.mts). Pure module — no db.
const { evaluateChefBlockers } = await import("@/lib/domain/chef-inzetbaarheid");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

console.log("=== Chef deployability gate (pure evaluateChefBlockers) ===\n");

const ready = evaluateChefBlockers({ status: "active", onboardingMissingCritical: [], idExpired: false });
assert("active + complete → deployable, no blockers", ready.deployable === true && ready.blockers.length === 0);

const archived = evaluateChefBlockers({ status: "archived", onboardingMissingCritical: [], idExpired: false });
assert("archived → blocked 'Gearchiveerd'", !archived.deployable && archived.blockers.includes("Gearchiveerd"));

const inactive = evaluateChefBlockers({ status: "inactive", onboardingMissingCritical: [], idExpired: false });
assert("inactive → blocked 'Status: inactief'", !inactive.deployable && inactive.blockers.includes("Status: inactief"));

const idExp = evaluateChefBlockers({ status: "active", onboardingMissingCritical: [], idExpired: true });
assert("idExpired → blocked 'ID-bewijs verlopen'", !idExp.deployable && idExp.blockers.includes("ID-bewijs verlopen"));

const missing = evaluateChefBlockers({ status: "active", onboardingMissingCritical: ["BSN", "IBAN"], idExpired: false });
assert("missing critical → 'Ontbreekt: …' per item", !missing.deployable && missing.blockers.includes("Ontbreekt: BSN") && missing.blockers.includes("Ontbreekt: IBAN"));

// Soft "almost" signals must NEVER hard-block — the gate is blocked-only.
const paused = evaluateChefBlockers({ status: "paused", onboardingMissingCritical: [], idExpired: false });
assert("paused alone → deployable (warning, not blocker)", paused.deployable === true && paused.blockers.length === 0);

const onboarding = evaluateChefBlockers({ status: "onboarding", onboardingMissingCritical: [], idExpired: false });
assert("onboarding status w/o missing critical → deployable", onboarding.deployable === true);

// Combined: order preserved (status → ID → missing), count exact.
const combo = evaluateChefBlockers({ status: "archived", onboardingMissingCritical: ["BSN"], idExpired: true });
assert("combined → 3 blockers in order", combo.blockers.length === 3 && combo.blockers[0] === "Gearchiveerd" && combo.blockers[1] === "ID-bewijs verlopen" && combo.blockers[2] === "Ontbreekt: BSN");

// archived takes precedence over inactive (else-if).
const both = evaluateChefBlockers({ status: "archived", onboardingMissingCritical: [], idExpired: false });
assert("archived not double-counted with inactive", both.blockers.filter((b) => b.startsWith("Status:") || b === "Gearchiveerd").length === 1);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
