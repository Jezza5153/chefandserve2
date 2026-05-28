/**
 * PR-1.7 smoke — per-employee settings (roster section). Run with tsx:
 *   npx tsx scripts/smoke-user-settings.mts
 * Asserts defaults, save+merge, and partial-patch persistence. Self-cleaning.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
if (!process.env.RATE_LIMIT_HASH_SECRET) {
  process.env.RATE_LIMIT_HASH_SECRET = "smoke-user-settings-0123456789abcdefghij";
}

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!);
const us = await import("@/lib/domain/user-settings");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

const ts = Date.now();
const userId = crypto.randomUUID();

console.log("=== PR-1.7 user-settings smoke ===\n");

try {
  await sql`INSERT INTO users (id, email, name, kind, status) VALUES (${userId}, ${`smoke-settings-${ts}@example.com`}, 'SMOKE Settings', 'internal', 'active')`;

  console.log("── defaults (no row) ──");
  const d = await us.getRosterSettings(userId);
  assert("default criticalHours 24", d.criticalHours === 24);
  assert("default view week", d.defaultView === "week");
  assert("default label findChef", d.labels.findChef === "Chef zoeken");

  console.log("\n── save + merge ──");
  await us.saveRosterSettings({
    userId,
    patch: { criticalHours: 48, defaultView: "month", labels: { findChef: "Bel rondje" } },
  });
  const s = await us.getRosterSettings(userId);
  assert("saved criticalHours 48", s.criticalHours === 48);
  assert("saved view month", s.defaultView === "month");
  assert("overridden label", s.labels.findChef === "Bel rondje");
  assert("untouched label keeps default", s.labels.full === "Vol");

  console.log("\n── partial patch keeps other keys ──");
  await us.saveRosterSettings({ userId, patch: { criticalHours: 36 } });
  const p = await us.getRosterSettings(userId);
  assert("patched criticalHours 36", p.criticalHours === 36);
  assert("defaultView preserved (month)", p.defaultView === "month");
  assert("label override preserved", p.labels.findChef === "Bel rondje");
} finally {
  console.log("\n── cleanup ──");
  await sql`DELETE FROM user_settings WHERE user_id=${userId}`;
  await sql`DELETE FROM audit_log WHERE resource='user_settings' AND resource_id=${userId}`;
  await sql`DELETE FROM users WHERE id=${userId}`;
  const [gone] = await sql`SELECT id FROM users WHERE id=${userId}`;
  assert("cleanup removed smoke rows", !gone);
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
