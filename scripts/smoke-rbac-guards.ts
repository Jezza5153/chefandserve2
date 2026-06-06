/**
 * PR-RBAC guards smoke — proves the escalation wall (G1–G3) blocks every path.
 * Pure (no DB). Run: npx tsx scripts/smoke-rbac-guards.ts
 */

import {
  assertCanAssignRole,
  assertCanGrantPerm,
  assertCanRevokePerm,
  assertCanSetRolePerms,
  RbacGuardError,
  type Actor,
} from "../src/lib/rbac/guards";
import { ROLE_GRANTS } from "../src/lib/rbac/catalog";

let pass = 0;
let fail = 0;
function expectOk(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log("  ✓", name);
  } catch (e) {
    fail++;
    console.log("  ✗", name, `(threw ${(e as RbacGuardError).reason ?? (e as Error).message})`);
  }
}
function expectBlock(name: string, reasonPrefix: string, fn: () => void) {
  try {
    fn();
    fail++;
    console.log("  ✗", name, "(did NOT throw)");
  } catch (e) {
    if (e instanceof RbacGuardError && e.reason.startsWith(reasonPrefix)) {
      pass++;
      console.log("  ✓", name);
    } else {
      fail++;
      console.log("  ✗", name, `(wrong throw: ${(e as Error).message})`);
    }
  }
}

const superAdmin: Actor = { isSuperAdmin: true, perms: new Set() };
const owner: Actor = { isSuperAdmin: false, perms: new Set(ROLE_GRANTS.owner) };
const planner: Actor = { isSuperAdmin: false, perms: new Set(ROLE_GRANTS.planner) };

console.log("=== RBAC escalation-guard smoke ===\n");

// super_admin bypasses everything
expectOk("super_admin grants a system perm", () => assertCanGrantPerm(superAdmin, "users.write"));
expectOk("super_admin assigns super_admin role", () =>
  assertCanAssignRole(superAdmin, "super_admin", ROLE_GRANTS.super_admin));
expectOk("super_admin sets a role with system perms", () =>
  assertCanSetRolePerms(superAdmin, ["audit.read", "chefs.read"]));

// G1 — system confinement for non-super_admins
expectBlock("G1: owner can't grant users.write (system)", "system_perm_forbidden", () =>
  assertCanGrantPerm(owner, "users.write"));
expectBlock("G1: owner can't revoke errors.read (system)", "system_perm_forbidden", () =>
  assertCanRevokePerm(owner, "errors.read"));
expectBlock("G1: owner can't assign super_admin role", "system_role_forbidden", () =>
  assertCanAssignRole(owner, "super_admin", ROLE_GRANTS.super_admin));
expectBlock("G1: owner can't set a role containing a system perm", "system_perm_forbidden", () =>
  assertCanSetRolePerms(owner, ["chefs.read", "audit.read"]));

// G2 — no escalation beyond self (planner lacks owner-only business perms)
expectBlock("G2: planner can't grant clients.write (lacks it)", "escalation_beyond_self", () =>
  assertCanGrantPerm(planner, "clients.write"));
expectBlock("G2: planner can't grant hours.approve (lacks it)", "escalation_beyond_self", () =>
  assertCanGrantPerm(planner, "hours.approve"));
expectOk("planner CAN grant chefs.read (holds it)", () => assertCanGrantPerm(planner, "chefs.read"));
expectOk("owner CAN grant a business perm it holds", () => assertCanGrantPerm(owner, "clients.write"));

// G3 — role-assignment confinement
expectOk("owner assigns planner role (business ⊆ owner)", () =>
  assertCanAssignRole(owner, "planner", ROLE_GRANTS.planner));
expectBlock("G3: planner can't assign owner role (exceeds planner)", "role_exceeds_actor", () =>
  assertCanAssignRole(planner, "owner", ROLE_GRANTS.owner));

// unknown perm is rejected
expectBlock("unknown perm rejected", "unknown_perm", () =>
  assertCanGrantPerm(superAdmin, "bogus.action"));

console.log(`\n=== guards smoke: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
