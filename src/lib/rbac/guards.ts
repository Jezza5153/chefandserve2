/**
 * RBAC escalation guards (PR-RBAC C4-C6) — the security wall that stops an
 * owner from granting themselves or staff MORE than they should. Pure +
 * unit-tested (scripts/smoke-rbac-guards.* / inline); every permission/role
 * mutation action in src/lib/rbac/manage.ts calls these BEFORE writing.
 *
 * The rules (super_admin bypasses all — the founder holds everything):
 *   G1  system confinement — a non-super_admin may never grant a SYSTEM perm
 *       (users/roles/audit/errors/webhooks/privacy/retention/integrations/…)
 *       or assign the super_admin role.
 *   G2  no escalation beyond self — a non-super_admin may only grant a BUSINESS
 *       perm they themselves currently hold.
 *   G3  role-assignment confinement — a non-super_admin may assign a role only
 *       if every perm that role grants is business-class AND ⊆ the actor's perms
 *       (and the role is not super_admin).
 *   G4  never strip the last super_admin (DB-coupled → enforced in manage.ts).
 *   G5  edits only apply to kind='internal' users (enforced in manage.ts).
 *
 * The system/business classification is a CODE constant (src/lib/rbac/catalog),
 * never a DB toggle an owner could flip.
 */

import { isSystemPermission, permKeyExists, SYSTEM_ROLE_KEYS } from "./catalog";

/** Thrown by a guard on a blocked mutation. `reason` is a stable machine code. */
export class RbacGuardError extends Error {
  constructor(public reason: string) {
    super(`rbac_guard_blocked:${reason}`);
    this.name = "RbacGuardError";
  }
}

export type Actor = {
  /** super_admin holds every permission and bypasses every guard. */
  isSuperAdmin: boolean;
  /** the actor's own effective permission keys ("resource.action"). */
  perms: ReadonlySet<string>;
};

/**
 * G1 + G2 — may `actor` grant `permKey` (to a role or a user)?
 * Throws RbacGuardError on violation; returns void if allowed.
 */
export function assertCanGrantPerm(actor: Actor, permKey: string): void {
  if (!permKeyExists(permKey)) throw new RbacGuardError(`unknown_perm:${permKey}`);
  if (actor.isSuperAdmin) return;
  if (isSystemPermission(permKey)) throw new RbacGuardError(`system_perm_forbidden:${permKey}`); // G1
  if (!actor.perms.has(permKey)) throw new RbacGuardError(`escalation_beyond_self:${permKey}`); // G2
}

/**
 * G1 — may `actor` REVOKE `permKey`? Non-super_admins may only touch business
 * perms (they can't manage system access at all, grant or revoke).
 */
export function assertCanRevokePerm(actor: Actor, permKey: string): void {
  if (!permKeyExists(permKey)) throw new RbacGuardError(`unknown_perm:${permKey}`);
  if (actor.isSuperAdmin) return;
  if (isSystemPermission(permKey)) throw new RbacGuardError(`system_perm_forbidden:${permKey}`); // G1
}

/**
 * G1 + G3 — may `actor` assign `roleKey` (whose grants are `roleGrants`)?
 * A non-super_admin may assign only a business-only role whose every perm they
 * themselves hold, and never the super_admin role.
 */
export function assertCanAssignRole(
  actor: Actor,
  roleKey: string,
  roleGrants: readonly string[],
): void {
  if (actor.isSuperAdmin) return;
  if (SYSTEM_ROLE_KEYS.has(roleKey)) throw new RbacGuardError(`system_role_forbidden:${roleKey}`); // G1
  for (const p of roleGrants) {
    if (isSystemPermission(p)) throw new RbacGuardError(`role_has_system_perm:${roleKey}/${p}`); // G3
    if (!actor.perms.has(p)) throw new RbacGuardError(`role_exceeds_actor:${roleKey}/${p}`); // G3
  }
}

/**
 * G1 + G3 — may `actor` save a custom role with `permKeys`? (role editor C4).
 * super_admin: any catalog perm. owner: business perms they hold only.
 */
export function assertCanSetRolePerms(actor: Actor, permKeys: readonly string[]): void {
  for (const p of permKeys) assertCanGrantPerm(actor, p);
}
