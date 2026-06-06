/**
 * RBAC management mutations (PR-RBAC C4-C6) — the ONLY path that writes roles,
 * role_permissions and user_permissions. Every function:
 *   1. builds the Actor from the session,
 *   2. runs the escalation guards (src/lib/rbac/guards) BEFORE any write,
 *   3. writes atomically (withTx) where multi-statement,
 *   4. bumps permissionsVersion so stale JWTs re-read (fan-out for role edits),
 *   5. audits — including rbac.escalation_blocked on a guard rejection.
 *
 * Used by the super_admin /admin/system/{roles,users} editors and the owner
 * /admin/business/team surface. The guards confine owners to business-class
 * perms + no-escalation-beyond-self; super_admin bypasses.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Session } from "next-auth";

import { recordAuditFromRequest } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { withTx } from "@/lib/db/tx";
import {
  permissions,
  rolePermissions,
  roles,
  userPermissions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { effectivePermissionKeys } from "@/lib/permissions";
import { isSystemPermission } from "@/lib/rbac/catalog";
import {
  assertCanAssignRole,
  assertCanGrantPerm,
  assertCanRevokePerm,
  assertCanSetRolePerms,
  RbacGuardError,
  type Actor,
} from "@/lib/rbac/guards";

export type ManageResult = { ok: true } | { ok: false; error: string };

/* ---------- helpers ------------------------------------------------------- */

async function actorFromSession(session: Session): Promise<Actor> {
  const isSuperAdmin = session.user.roles?.includes("super_admin") ?? false;
  const perms = isSuperAdmin ? new Set<string>() : await effectivePermissionKeys(session);
  return { isSuperAdmin, perms };
}

/** A role's CURRENT grant keys, loaded from the DB (covers custom + edited roles). */
async function roleGrantKeys(roleKey: string): Promise<string[]> {
  const rows = await db
    .select({ resource: permissions.resource, action: permissions.action })
    .from(rolePermissions)
    .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(roles.key, roleKey));
  return rows.map((r) => `${r.resource}.${r.action}`);
}

async function permIdByKey(key: string): Promise<string | null> {
  const [resource, action] = key.split(".");
  const [row] = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(and(eq(permissions.resource, resource), eq(permissions.action, action)))
    .limit(1);
  return row?.id ?? null;
}

/** G4 — is `targetUserId` the ONLY user holding super_admin? */
async function isLastSuperAdmin(targetUserId: string): Promise<boolean> {
  const supers = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(roles.key, "super_admin"));
  const uniq = new Set(supers.map((s) => s.userId));
  return uniq.size <= 1 && uniq.has(targetUserId);
}

async function auditBlocked(session: Session, action: string, detail: Record<string, unknown>) {
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "rbac.escalation_blocked",
    resource: "rbac",
    after: { attempted: action, ...detail },
  }).catch(() => {});
}

async function bumpVersion(userIds: string[]) {
  if (userIds.length === 0) return;
  await db
    .update(users)
    .set({ permissionsVersion: sql`${users.permissionsVersion} + 1`, updatedAt: new Date() })
    .where(inArray(users.id, userIds));
}

/* ---------- C6: assign roles to a user ------------------------------------ */

export async function assignRoles(args: {
  session: Session;
  targetUserId: string;
  roleKeys: string[];
}): Promise<ManageResult> {
  const actor = await actorFromSession(args.session);
  const target = await db.query.users.findFirst({ where: eq(users.id, args.targetUserId) });
  if (!target) return { ok: false, error: "not_found" };
  if (target.kind !== "internal") return { ok: false, error: "not_internal" }; // G5

  const current = await db
    .select({ key: roles.key, roleId: userRoles.roleId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, args.targetUserId));
  const currentKeys = new Set(current.map((c) => c.key));
  const targetKeys = new Set(args.roleKeys);

  // Only super_admin may add OR remove the super_admin role (system membership).
  if (!actor.isSuperAdmin && (currentKeys.has("super_admin") || targetKeys.has("super_admin"))) {
    await auditBlocked(args.session, "assignRoles", { targetUserId: args.targetUserId, roleKeys: args.roleKeys });
    return { ok: false, error: "system_role_forbidden" };
  }
  // G4 — never strip the last super_admin.
  if (currentKeys.has("super_admin") && !targetKeys.has("super_admin") && (await isLastSuperAdmin(args.targetUserId))) {
    return { ok: false, error: "last_super_admin" };
  }
  // G1+G3 — actor may only ADD roles it is allowed to assign.
  for (const key of targetKeys) {
    if (currentKeys.has(key)) continue;
    try {
      assertCanAssignRole(actor, key, await roleGrantKeys(key));
    } catch (e) {
      if (e instanceof RbacGuardError) {
        await auditBlocked(args.session, "assignRoles", { role: key, reason: e.reason });
        return { ok: false, error: e.reason };
      }
      throw e;
    }
  }

  const allRoles = await db.select().from(roles);
  const roleIdByKey = new Map(allRoles.map((r) => [r.key, r.id]));

  await withTx(async (tx) => {
    for (const key of targetKeys) {
      if (!currentKeys.has(key)) {
        const rid = roleIdByKey.get(key);
        if (rid) {
          await tx
            .insert(userRoles)
            .values({ userId: args.targetUserId, roleId: rid, grantedBy: args.session.user.id })
            .onConflictDoNothing();
        }
      }
    }
    for (const row of current) {
      if (!targetKeys.has(row.key)) {
        await tx
          .delete(userRoles)
          .where(and(eq(userRoles.userId, args.targetUserId), eq(userRoles.roleId, row.roleId)));
      }
    }
  });
  await bumpVersion([args.targetUserId]);
  await recordAuditFromRequest({
    userId: args.session.user.id,
    action: "user.roles_updated",
    resource: "users",
    resourceId: args.targetUserId,
    after: { roles: [...targetKeys] },
  });
  return { ok: true };
}

/* ---------- C5/C6: per-user permission override --------------------------- */

export async function setUserPermission(args: {
  session: Session;
  targetUserId: string;
  resource: string;
  action: string;
  effect: "grant" | "revoke" | "inherit";
}): Promise<ManageResult> {
  const actor = await actorFromSession(args.session);
  const target = await db.query.users.findFirst({ where: eq(users.id, args.targetUserId) });
  if (!target) return { ok: false, error: "not_found" };
  if (target.kind !== "internal") return { ok: false, error: "not_internal" }; // G5

  const permKey = `${args.resource}.${args.action}`;
  try {
    if (args.effect === "grant") assertCanGrantPerm(actor, permKey); // G1+G2
    else assertCanRevokePerm(actor, permKey); // G1 (revoke/inherit touch the same perm)
  } catch (e) {
    if (e instanceof RbacGuardError) {
      await auditBlocked(args.session, "setUserPermission", { permKey, effect: args.effect, reason: e.reason });
      return { ok: false, error: e.reason };
    }
    throw e;
  }

  if (args.effect === "inherit") {
    await db
      .delete(userPermissions)
      .where(
        and(
          eq(userPermissions.userId, args.targetUserId),
          eq(userPermissions.resource, args.resource),
          eq(userPermissions.action, args.action),
        ),
      );
  } else {
    await db
      .insert(userPermissions)
      .values({
        userId: args.targetUserId,
        resource: args.resource,
        action: args.action,
        effect: args.effect,
        grantedBy: args.session.user.id,
      })
      .onConflictDoUpdate({
        target: [userPermissions.userId, userPermissions.resource, userPermissions.action],
        set: { effect: args.effect, grantedBy: args.session.user.id },
      });
  }
  await bumpVersion([args.targetUserId]);
  await recordAuditFromRequest({
    userId: args.session.user.id,
    action: "user.permission_set",
    resource: "users",
    resourceId: args.targetUserId,
    after: { permKey, effect: args.effect },
  });
  return { ok: true };
}

/* ---------- C4: role editor ----------------------------------------------- */

export async function saveRolePermissions(args: {
  session: Session;
  roleKey: string;
  permKeys: string[];
}): Promise<ManageResult> {
  const actor = await actorFromSession(args.session);
  if (args.roleKey === "super_admin" && !actor.isSuperAdmin) {
    await auditBlocked(args.session, "saveRolePermissions", { roleKey: args.roleKey });
    return { ok: false, error: "system_role_forbidden" };
  }
  // G1+G2 — actor may only put perms it is allowed to grant into the role.
  try {
    assertCanSetRolePerms(actor, args.permKeys);
  } catch (e) {
    if (e instanceof RbacGuardError) {
      await auditBlocked(args.session, "saveRolePermissions", { roleKey: args.roleKey, reason: e.reason });
      return { ok: false, error: e.reason };
    }
    throw e;
  }

  const [role] = await db.select().from(roles).where(eq(roles.key, args.roleKey)).limit(1);
  if (!role) return { ok: false, error: "role_not_found" };

  const targetIds = new Set<string>();
  for (const k of args.permKeys) {
    const pid = await permIdByKey(k);
    if (!pid) return { ok: false, error: `unknown_perm:${k}` };
    targetIds.add(pid);
  }

  // For a non-super_admin actor, also preserve any SYSTEM perms already on the
  // role (they can't see/edit those, so the form can't drop them).
  if (!actor.isSuperAdmin) {
    // Preserve any SYSTEM perms already on the role — a non-super_admin can't
    // see/manage them, so their form would otherwise silently drop them.
    for (const k of await roleGrantKeys(args.roleKey)) {
      if (isSystemPermission(k)) {
        const pid = await permIdByKey(k);
        if (pid) targetIds.add(pid);
      }
    }
  }

  // affected users (for the version fan-out) BEFORE the change.
  const holders = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.roleId, role.id));
  const holderIds = [...new Set(holders.map((h) => h.userId))];

  await withTx(async (tx) => {
    const existing = await tx
      .select({ permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, role.id));
    for (const row of existing) {
      if (!targetIds.has(row.permissionId)) {
        await tx
          .delete(rolePermissions)
          .where(and(eq(rolePermissions.roleId, role.id), eq(rolePermissions.permissionId, row.permissionId)));
      }
    }
    for (const pid of targetIds) {
      await tx
        .insert(rolePermissions)
        .values({ roleId: role.id, permissionId: pid })
        .onConflictDoNothing();
    }
    // fan-out: every holder's JWT must re-read.
    if (holderIds.length > 0) {
      await tx
        .update(users)
        .set({ permissionsVersion: sql`${users.permissionsVersion} + 1`, updatedAt: new Date() })
        .where(inArray(users.id, holderIds));
    }
  });
  await recordAuditFromRequest({
    userId: args.session.user.id,
    action: "role.permissions_updated",
    resource: "roles",
    resourceId: role.id,
    after: { roleKey: args.roleKey, permCount: targetIds.size, holdersBumped: holderIds.length },
  });
  return { ok: true };
}

/* ---------- C4: create a custom role -------------------------------------- */

export async function createRole(args: {
  session: Session;
  key: string;
  label: string;
  description?: string;
}): Promise<ManageResult> {
  const actor = await actorFromSession(args.session);
  const key = args.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!key) return { ok: false, error: "invalid_key" };
  if (key === "super_admin" && !actor.isSuperAdmin) return { ok: false, error: "system_role_forbidden" };

  const [existing] = await db.select().from(roles).where(eq(roles.key, key)).limit(1);
  if (existing) return { ok: false, error: "role_exists" };

  await db
    .insert(roles)
    .values({ key, label: args.label.trim() || key, description: args.description?.trim() || null })
    .onConflictDoNothing();
  await recordAuditFromRequest({
    userId: args.session.user.id,
    action: "role.created",
    resource: "roles",
    after: { key, label: args.label },
  });
  return { ok: true };
}

/* ---------- C6: create an internal employee (owner + super_admin) --------- */

export async function createEmployee(args: {
  session: Session;
  email: string;
  name: string;
  roleKey: string;
}): Promise<ManageResult & { userId?: string }> {
  const actor = await actorFromSession(args.session);
  // G1+G3 — guard the role the new hire will receive (owner can't mint a
  // super_admin or a role exceeding their own perms).
  try {
    assertCanAssignRole(actor, args.roleKey, await roleGrantKeys(args.roleKey));
  } catch (e) {
    if (e instanceof RbacGuardError) {
      await auditBlocked(args.session, "createEmployee", { roleKey: args.roleKey, reason: e.reason });
      return { ok: false, error: e.reason };
    }
    throw e;
  }
  const { inviteInternalStaff } = await import("@/lib/domain/portal-invites");
  const res = await inviteInternalStaff({
    email: args.email,
    name: args.name,
    role: args.roleKey,
    actingUserId: args.session.user.id,
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, userId: res.userId };
}
