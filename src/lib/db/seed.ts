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
import { sql } from "drizzle-orm";
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

/* ----------------------------- config ----------------------------------- */

const DB_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!DB_URL) {
  throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set");
}

const dbClient = drizzle(neon(DB_URL));

// All Phase 0 permissions. Keep flat — easy to scan.
const PERMISSIONS: { resource: string; action: string }[] = [
  // Tech / system surface (super_admin only)
  { resource: "users", action: "read" },
  { resource: "users", action: "write" },
  { resource: "roles", action: "read" },
  { resource: "roles", action: "write" },
  { resource: "audit", action: "read" },
  { resource: "errors", action: "read" },
  { resource: "errors", action: "resolve" },
  // Business surface (owner + super_admin)
  { resource: "dashboard", action: "read" },
  { resource: "chefs", action: "read" },
  { resource: "clients", action: "read" },
  { resource: "shifts", action: "read" },
  { resource: "hours", action: "read" },
  { resource: "invoices", action: "read" },
  // PR-FB-1: planner/owner write surfaces
  { resource: "chefs", action: "write" },
  { resource: "shifts", action: "write" },
  { resource: "forms", action: "read" },
  { resource: "forms", action: "write" },
  { resource: "reminders", action: "read" },
  { resource: "reminders", action: "write" },
];

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

// Which permissions each role gets. super_admin = all; owner = business only.
const ROLE_PERMS: Record<string, string[]> = {
  super_admin: PERMISSIONS.map((p) => `${p.resource}.${p.action}`),
  owner: [
    "dashboard.read",
    "chefs.read",
    "chefs.write",
    "clients.read",
    "shifts.read",
    "shifts.write",
    "hours.read",
    "invoices.read",
    "forms.read",
    "forms.write",
    "reminders.read",
    "reminders.write",
  ],
  // PR-FB-1: planner = chefs + shift/roster planning + forms + reminders.
  // Deliberately NO clients-write / hours-approval / invoices / system.
  planner: [
    "dashboard.read",
    "chefs.read",
    "chefs.write",
    "clients.read",
    "shifts.read",
    "shifts.write",
    "hours.read",
    "forms.read",
    "forms.write",
    "reminders.read",
    "reminders.write",
  ],
};

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
    for (const permKey of permKeys) {
      const pId = permId(permKey);
      if (!pId) throw new Error(`Seed bug: permission ${permKey} not found`);
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
