// PR-RBAC C1 smoke — the effective-permission merge engine:
//   effective = (role grants ∪ user grants) − user revokes   (revoke wins).
// Replicates loadEffectivePermissionSet's queries against the dev DB with a
// throwaway planner user. Non-destructive: cleans up in finally. Run:
//   node scripts/smoke-rbac-engine.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

import { randomUUID } from "node:crypto";

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

let pass = 0;
let fail = 0;
function assert(name, cond) {
  if (cond) {
    console.log("  ✓", name);
    pass++;
  } else {
    console.log("  ✗", name);
    fail++;
  }
}

/** Mirror of loadEffectivePermissionSet (single role is enough for the merge test). */
async function effectiveSet(userId, roleKey) {
  const set = new Set();
  const rolePerms = await sql`
    SELECT p.resource, p.action FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    JOIN roles r ON r.id = rp.role_id
    WHERE r.key = ${roleKey}`;
  for (const r of rolePerms) set.add(`${r.resource}.${r.action}`);
  const overrides = await sql`SELECT resource, action, effect FROM user_permissions WHERE user_id = ${userId}`;
  for (const o of overrides) {
    const k = `${o.resource}.${o.action}`;
    if (o.effect === "grant") set.add(k);
    else set.delete(k);
  }
  return set;
}

const SMOKE_NAME = `RBAC Smoke ${randomUUID().slice(0, 8)}`;
let userId = null;

try {
  console.log("=== RBAC effective-set engine smoke ===\n");

  // users.id is a Drizzle $defaultFn (no DB default) — supply it in raw SQL.
  const [u] = await sql`
    INSERT INTO users (id, seed_key, email, name, kind, status)
    VALUES (gen_random_uuid()::text, ${"smoke-" + randomUUID().slice(0, 8)}, ${"smoke-" + randomUUID().slice(0, 8) + "@test.local"}, ${SMOKE_NAME}, 'internal', 'active')
    RETURNING id`;
  userId = u.id;
  const [planner] = await sql`SELECT id FROM roles WHERE key='planner'`;
  await sql`INSERT INTO user_roles (user_id, role_id) VALUES (${userId}, ${planner.id})`;

  // baseline (no overrides) — planner's role grants only
  let eff = await effectiveSet(userId, "planner");
  assert("baseline: planner has chefs.read (role grant)", eff.has("chefs.read"));
  assert("baseline: planner has shifts.read", eff.has("shifts.read"));
  assert("baseline: planner LACKS clients.read (owner-only)", !eff.has("clients.read"));
  assert("baseline: planner LACKS cockpit.read (owner-only)", !eff.has("cockpit.read"));
  assert("baseline: planner LACKS users.read (system)", !eff.has("users.read"));

  // add a grant + a revoke
  await sql`INSERT INTO user_permissions (user_id, resource, action, effect) VALUES
    (${userId}, 'clients', 'read', 'grant'),
    (${userId}, 'chefs', 'read', 'revoke')`;
  eff = await effectiveSet(userId, "planner");
  assert("grant: clients.read now present", eff.has("clients.read"));
  assert("revoke: chefs.read removed (revoke beats role grant)", !eff.has("chefs.read"));
  assert("untouched role perm shifts.read still present", eff.has("shifts.read"));
} finally {
  if (userId) await sql`DELETE FROM users WHERE id = ${userId}`; // cascades user_roles + user_permissions
}

console.log(`\n=== RBAC engine smoke: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
