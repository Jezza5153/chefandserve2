/**
 * Resolves the AI assistant's acting identity from a human user id.
 *
 * The assistant has NO authority of its own — it borrows the requesting human's
 * effective permission set (the SAME set the app's own RBAC gates use, via
 * {@link computeEffectivePermissionSet}) and can never exceed it. This is the
 * security keystone: the executor's permission check is only as trustworthy as
 * the ceiling built here.
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { roles, userRoles } from "@/lib/db/schema";
import { CATALOG } from "@/lib/rbac/catalog";
import { computeEffectivePermissionSet } from "@/lib/permissions";
import type { AiActor } from "@/lib/ai/types";

/**
 * Build the {@link AiActor} for a human (V1: the owner). Resolves the human's roles,
 * then their effective permission keys — granting the full catalog only to a
 * super_admin (the founder bypass that mirrors the app's own gates).
 */
export async function resolveAiActor(userId: string): Promise<AiActor> {
  const roleRows = await db
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  const roleKeys = roleRows.map((r) => r.key);

  const isSuperAdmin = roleKeys.includes("super_admin");
  const effectivePerms: ReadonlySet<string> = isSuperAdmin
    ? new Set(CATALOG.map((p) => p.key)) // founder bypass — holds the whole catalog
    : await computeEffectivePermissionSet(userId, roleKeys);

  const requestedByRole = isSuperAdmin
    ? "super_admin"
    : roleKeys.includes("owner")
      ? "owner"
      : (roleKeys[0] ?? "unknown");

  return {
    requestedByUserId: userId,
    requestedByRole,
    // V1: the human owns the audit row; AI-initiated calls are distinguished by the
    // `after._ai` marker. When a dedicated PA service account is seeded, this returns
    // its id instead (no other code changes needed — the executor/sink already key off it).
    paServiceUserId: userId,
    effectivePerms,
  };
}
