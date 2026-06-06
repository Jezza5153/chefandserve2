/**
 * PR-RBAC manage smoke (C4-C6) — proves the mutation layer BLOCKS escalation
 * end-to-end: real manage.ts functions, real DB, fake owner/planner sessions.
 * Focuses on the blocked paths (the security wall). Non-destructive: one
 * throwaway internal user, cleaned up in finally. Run:
 *   npx tsx scripts/smoke-rbac-manage.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";

import { assignRoles, saveRolePermissions, setUserPermission } from "../src/lib/rbac/manage";

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!);

let pass = 0;
let fail = 0;
function assertBlocked(name: string, res: { ok: boolean; error?: string }, prefix: string) {
  if (!res.ok && (res.error ?? "").startsWith(prefix)) {
    console.log("  ✓", name);
    pass++;
  } else {
    console.log("  ✗", name, `— got ${JSON.stringify(res)}`);
    fail++;
  }
}

const ownerSession = { user: { id: randomUUID(), roles: ["owner"] } } as never;
const plannerSession = { user: { id: randomUUID(), roles: ["planner"] } } as never;

async function main() {
  console.log("=== RBAC manage escalation smoke ===\n");
  let targetId: string | null = null;
  try {
    const [u] = await sql`
      INSERT INTO users (id, seed_key, email, name, kind, status)
      VALUES (gen_random_uuid()::text, ${"smoke-" + randomUUID().slice(0, 8)}, ${"smoke-" + randomUUID().slice(0, 8) + "@test.local"}, 'RBAC Manage Smoke', 'internal', 'active')
      RETURNING id`;
    targetId = u.id as string;

    assertBlocked(
      "G1: owner can't grant users.write override",
      await setUserPermission({ session: ownerSession, targetUserId: targetId, resource: "users", action: "write", effect: "grant" }),
      "system_perm_forbidden",
    );
    assertBlocked(
      "G1: owner can't assign super_admin role",
      await assignRoles({ session: ownerSession, targetUserId: targetId, roleKeys: ["super_admin"] }),
      "system_role_forbidden",
    );
    assertBlocked(
      "G1: owner can't add audit.read to the planner role",
      await saveRolePermissions({ session: ownerSession, roleKey: "planner", permKeys: ["chefs.read", "audit.read"] }),
      "system_perm_forbidden",
    );
    assertBlocked(
      "G2: planner can't grant clients.write override (lacks it)",
      await setUserPermission({ session: plannerSession, targetUserId: targetId, resource: "clients", action: "write", effect: "grant" }),
      "escalation_beyond_self",
    );

    const [chef] = await sql`SELECT id FROM users WHERE kind <> 'internal' LIMIT 1`;
    if (chef) {
      assertBlocked(
        "G5: cannot set override on a non-internal user",
        await setUserPermission({ session: ownerSession, targetUserId: chef.id as string, resource: "chefs", action: "read", effect: "grant" }),
        "not_internal",
      );
    } else {
      console.log("  · (no non-internal user to test G5 — skipped)");
    }
  } finally {
    if (targetId) await sql`DELETE FROM users WHERE id = ${targetId}`;
  }

  console.log(`\n=== manage escalation smoke: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
