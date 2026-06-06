/**
 * Idempotent seed — Phase 0.
 *
 * Run with: npm run db:seed
 *
 * Seeds:
 *   - 18 permissions (resource × action)
 *   - 3 roles: super_admin (all), owner (operations), planner (chefs/shifts/forms/reminders)
 *   - 3 users: Jezza (super_admin, active), Maarten/Gina (owner, invited)
 *
 * Idempotency strategy:
 *   - permissions: ON CONFLICT (resource, action) DO NOTHING
 *   - roles: ON CONFLICT (key) DO NOTHING
 *   - rolePermissions: ON CONFLICT (role_id, permission_id) DO NOTHING
 *   - users: ON CONFLICT (seed_key) DO NOTHING
 *           (so changing the email later doesn't make seed re-create the user)
 *   - userRoles: ON CONFLICT (user_id, role_id) DO NOTHING
 *
 * Running this twice produces zero diffs.
 */

import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

import {
  permissions,
  roles,
  rolePermissions,
  userRoles,
  users,
} from "./schema";
import { CATALOG, ROLE_GRANTS } from "../rbac/catalog";

/* ----------------------------- config ----------------------------------- */

const DB_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!DB_URL) {
  throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set");
}

const dbClient = drizzle(neon(DB_URL));

// Permissions are the single source of truth in src/lib/rbac/catalog.ts
// (PR-RBAC-1). The seed inserts them + reconciles each role's grants below.
const PERMISSIONS: { resource: string; action: string }[] = CATALOG.map((p) => ({
  resource: p.resource,
  action: p.action,
}));

const ROLES = [
  {
    key: "super_admin",
    label: "Super admin (IT)",
    description: "Full system + business access. Sees errors and audit.",
  },
  {
    key: "owner",
    label: "Owner",
    description: "Full business operations. No system/error/audit views.",
  },
  {
    key: "planner",
    label: "Planner",
    description:
      "Plant shifts/rooster, bewerkt chefs, bouwt formulieren, beheert herinneringen. Geen klant-/uren-/payroll-/systeembeheer.",
  },
] as const;

// Role → permission grants come from the catalog (PR-RBAC-1). Engineered to
// mirror today's role-name access EXACTLY — proven by
// scripts/audit-permission-parity.ts. The seed reconciles role_permissions to
// these exactly (delete stale + insert missing) so the dormant→live flip is safe.
const ROLE_PERMS: Record<string, string[]> = ROLE_GRANTS;

type SeedUser = {
  seedKey: string;
  email: string;
  name: string;
  status: "active" | "invited";
  role: "super_admin" | "owner";
};

function normalizeEmail(email: string | undefined, fallback: string): string {
  return (email ?? fallback).trim().toLowerCase();
}

const SEED_USERS: SeedUser[] = [
  {
    seedKey: "jezza",
    email: normalizeEmail(process.env.JEZZA_EMAIL, "info@jezzacooks.com"),
    name: "Jezza",
    status: "active",
    role: "super_admin",
  },
  {
    seedKey: "maarten",
    email: normalizeEmail(process.env.MAARTEN_EMAIL, "maarten@jezzacooks.com"),
    name: "Maarten Hogeveen",
    status: "invited", // placeholder email — flip to active when real email is set
    role: "owner",
  },
  {
    seedKey: "gina",
    email: normalizeEmail(process.env.GINA_EMAIL, "gina@jezzacooks.com"),
    name: "Gina",
    status: "invited",
    role: "owner",
  },
];

/* ----------------------------- seed runner ------------------------------- */

async function seed() {
  console.log("🌱 Chef & Serve — Phase 0 seed\n");

  /* permissions */
  console.log(`  Permissions (${PERMISSIONS.length})...`);
  for (const p of PERMISSIONS) {
    await dbClient
      .insert(permissions)
      .values(p)
      .onConflictDoNothing({ target: [permissions.resource, permissions.action] });
  }

  /* roles */
  console.log(`  Roles (${ROLES.length})...`);
  for (const r of ROLES) {
    await dbClient
      .insert(roles)
      .values(r)
      .onConflictDoNothing({ target: roles.key });
  }

  /* role → permission mappings */
  console.log("  Role permissions...");
  const allRoles = await dbClient.select().from(roles);
  const allPerms = await dbClient.select().from(permissions);
  const permId = (key: string) => {
    const [resource, action] = key.split(".");
    return allPerms.find((p) => p.resource === resource && p.action === action)?.id;
  };
  const roleId = (key: string) => allRoles.find((r) => r.key === key)?.id;

  for (const [roleKey, permKeys] of Object.entries(ROLE_PERMS)) {
    const rId = roleId(roleKey);
    if (!rId) throw new Error(`Seed bug: role ${roleKey} not found after insert`);
    const targetIds = new Set<string>();
    for (const permKey of permKeys) {
      const pId = permId(permKey);
      if (!pId) throw new Error(`Seed bug: permission ${permKey} not found`);
      targetIds.add(pId);
    }
    // Reconcile to EXACTLY the catalog grants. The old Phase-0 seed left stale
    // planner grants (clients.read / hours.read / dashboard.read) that would
    // WIDEN access once gates check permissions — delete anything not in target.
    const existing = await dbClient
      .select()
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, rId));
    for (const row of existing) {
      if (!targetIds.has(row.permissionId)) {
        await dbClient
          .delete(rolePermissions)
          .where(
            and(
              eq(rolePermissions.roleId, rId),
              eq(rolePermissions.permissionId, row.permissionId),
            ),
          );
      }
    }
    for (const pId of targetIds) {
      await dbClient
        .insert(rolePermissions)
        .values({ roleId: rId, permissionId: pId })
        .onConflictDoNothing();
    }
  }

  /* users */
  console.log(`  Users (${SEED_USERS.length})...`);
  for (const u of SEED_USERS) {
    await dbClient
      .insert(users)
      .values({
        seedKey: u.seedKey,
        email: u.email,
        name: u.name,
        kind: "internal",
        status: u.status,
      })
      .onConflictDoNothing({ target: users.seedKey });
  }

  /* user → role mappings (idempotent: ON CONFLICT on composite PK) */
  console.log("  User roles...");
  const allUsers = await dbClient.select().from(users);
  for (const u of SEED_USERS) {
    const dbUser = allUsers.find((au) => au.seedKey === u.seedKey);
    if (!dbUser) throw new Error(`Seed bug: user ${u.seedKey} not found`);
    const rId = roleId(u.role);
    if (!rId) throw new Error(`Seed bug: role ${u.role} not found`);
    await dbClient
      .insert(userRoles)
      .values({ userId: dbUser.id, roleId: rId })
      .onConflictDoNothing();
  }

  /* summary */
  const [permCount] = await dbClient
    .select({ n: sql<number>`count(*)::int` })
    .from(permissions);
  const [roleCount] = await dbClient
    .select({ n: sql<number>`count(*)::int` })
    .from(roles);
  const [userCount] = await dbClient
    .select({ n: sql<number>`count(*)::int` })
    .from(users);

  console.log("\n✓ Seed complete.");
  console.log(`  permissions: ${permCount.n}`);
  console.log(`  roles:       ${roleCount.n}`);
  console.log(`  users:       ${userCount.n}`);

  console.log("\nSeeded users:");
  for (const u of SEED_USERS) {
    console.log(
      `  ${u.role.padEnd(12)} ${u.email.padEnd(35)} (${u.status})`,
    );
  }
  console.log(
    "\nReminder: only `active` users can log in. Maarten + Gina are invited",
  );
  console.log(
    "  until real emails are set (UPDATE users SET email='...', status='active' WHERE seed_key='maarten')",
  );
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n✗ Seed failed:", err);
    process.exit(1);
  });
