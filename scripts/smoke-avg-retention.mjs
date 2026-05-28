/**
 * PR-AVG-3 smoke — retention worker three-state gate + tombstone replay.
 *
 *   node scripts/smoke-avg-retention.mjs
 *
 * Seeds ONE soft-deleted chef_document backdated 10y (the seeded policy is
 * 2y, so it's expired) and asserts:
 *   - disabled  (no flags)        → worker exits "disabled", fixture survives
 *   - dry-run   (ENABLED only)    → reports candidates, deletes nothing
 *   - live      (ENABLED+!DRY)    → fixture row is purged
 * Then seeds a tombstone + a "resurrected" user and asserts the backup-replay
 * script re-anonymises it. Self-cleaning. Safe to re-run.
 *
 * The live step is GUARDED: it only runs if the ONLY expired candidates are our
 * fixture (true for this fresh app), so it can never delete real data.
 */

import { execFileSync } from "node:child_process";
import { config } from "dotenv";
config({ path: ".env.local" });

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

let pass = 0;
let fail = 0;
function assert(name, cond, detail) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

function runWorker(extraEnv) {
  try {
    return execFileSync("npx", ["tsx", "workers/retention.ts"], {
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    return (e.stdout ?? "") + (e.stderr ?? "");
  }
}

const ts = Date.now();
const uuid = () => crypto.randomUUID();
const chefId = uuid();
const docId = uuid();
const replayUserId = uuid();
let tombId = null;

console.log("=== PR-AVG-3 retention + replay smoke ===\n");

try {
  console.log("── seed expired soft-deleted document ──");
  // Ensure the chef_documents policy exists (seeded by seed-retention-policies).
  const [pol] = await sql`SELECT retention_period FROM retention_policies WHERE entity_type='chef_documents'`;
  assert("chef_documents retention policy exists", Boolean(pol), "run seed-retention-policies.mjs");

  await sql`INSERT INTO chefs (id, full_name, status) VALUES (${chefId}, ${`SMOKE Retention Chef ${ts}`}, 'active')`;
  await sql`INSERT INTO chef_documents (id, chef_id, type, filename, r2_key, status, deleted_at)
    VALUES (${docId}, ${chefId}, 'cv', 'old-cv.pdf', ${`chefs/${chefId}/${docId}/old-cv.pdf`}, 'rejected', now() - interval '10 years')`;
  assert("seeded soft-deleted document (10y old)", true);

  // ── disabled ──
  console.log("\n── gate: disabled (default) ──");
  const outDisabled = runWorker({ RETENTION_ENABLED: "", RETENTION_DRY_RUN: "" });
  assert("worker logs 'disabled'", /disabled/i.test(outDisabled), outDisabled.slice(-200));
  const [stillThere1] = await sql`SELECT id FROM chef_documents WHERE id=${docId}`;
  assert("fixture survives disabled run", Boolean(stillThere1));

  // ── dry-run ──
  console.log("\n── gate: dry-run (ENABLED, DRY_RUN default true) ──");
  const outDry = runWorker({ RETENTION_ENABLED: "true", RETENTION_DRY_RUN: "true" });
  assert("worker logs DRY-RUN", /DRY-RUN/i.test(outDry), outDry.slice(-200));
  assert("dry-run reports ≥1 chef_documents candidate", /chef_documents — [1-9]/.test(outDry), outDry.slice(-300));
  const [stillThere2] = await sql`SELECT id FROM chef_documents WHERE id=${docId}`;
  assert("fixture survives dry-run", Boolean(stillThere2));

  // ── live (guarded) ──
  console.log("\n── gate: live (ENABLED + DRY_RUN=false) ──");
  const [{ docs }] = await sql`SELECT count(*)::int AS docs FROM chef_documents WHERE deleted_at IS NOT NULL AND (deleted_at + (SELECT retention_period FROM retention_policies WHERE entity_type='chef_documents')::interval) < now()`;
  const [{ chefsN }] = await sql`SELECT count(*)::int AS "chefsN" FROM chefs c WHERE deleted_at IS NOT NULL AND (deleted_at + (SELECT retention_period FROM retention_policies WHERE entity_type='chefs')::interval) < now() AND NOT EXISTS (SELECT 1 FROM shift_hours sh WHERE sh.chef_id=c.id) AND NOT EXISTS (SELECT 1 FROM placements p WHERE p.chef_id=c.id) AND NOT EXISTS (SELECT 1 FROM ratings rt WHERE rt.chef_id=c.id)`;
  const [{ clientsN }] = await sql`SELECT count(*)::int AS "clientsN" FROM clients cl WHERE deleted_at IS NOT NULL AND (deleted_at + (SELECT retention_period FROM retention_policies WHERE entity_type='clients')::interval) < now() AND NOT EXISTS (SELECT 1 FROM shift_hours sh WHERE sh.client_id=cl.id)`;

  if (docs === 1 && chefsN === 0 && clientsN === 0) {
    const outLive = runWorker({ RETENTION_ENABLED: "true", RETENTION_DRY_RUN: "false" });
    assert("worker logs purge in live mode", /purged/i.test(outLive), outLive.slice(-200));
    const gone = await sql`SELECT id FROM chef_documents WHERE id=${docId}`;
    assert("fixture row PURGED by live run", gone.length === 0);
  } else {
    console.log(`  ⚠ skipping live deletion — other expired candidates present (docs=${docs}, chefs=${chefsN}, clients=${clientsN}) to protect real data`);
    assert("live deletion test skipped safely (not a failure)", true);
  }

  // ── tombstone replay ──
  console.log("\n── backup-replay: re-anonymise a resurrected user ──");
  // a user that "came back" via a restore (NOT anonymised) + a tombstone for it
  await sql`INSERT INTO users (id, email, name, kind, status) VALUES (${replayUserId}, ${`smoke-replay-${ts}@example.com`}, 'SMOKE Resurrected', 'chef', 'active')`;
  const [tomb] = await sql`INSERT INTO privacy_erasure_tombstones (original_user_id, hashed_email, reason) VALUES (${replayUserId}, ${`smoke-hash-${ts}`}, 'SMOKE replay') RETURNING id`;
  tombId = tomb.id;

  const outReplay = execFileSync("node", ["scripts/replay-erasure-tombstones.mjs"], { encoding: "utf8", env: process.env });
  assert("replay script ran", /re-anonymised/.test(outReplay), outReplay.slice(-200));
  const [replayed] = await sql`SELECT email, status FROM users WHERE id=${replayUserId}`;
  assert("resurrected user re-anonymised", replayed.email === `deleted-${replayUserId}@erased.invalid` && replayed.status === "disabled", replayed?.email);

  // idempotent second run
  const outReplay2 = execFileSync("node", ["scripts/replay-erasure-tombstones.mjs", "--dry-run"], { encoding: "utf8", env: process.env });
  assert("replay is idempotent (dry-run shows 0 to re-anonymise users)", /users=0/.test(outReplay2), outReplay2.slice(-200));
} finally {
  console.log("\n── cleanup ──");
  await sql`DELETE FROM chef_documents WHERE id=${docId}`;
  await sql`DELETE FROM chefs WHERE id=${chefId}`;
  if (tombId) await sql`DELETE FROM privacy_erasure_tombstones WHERE id=${tombId}`;
  await sql`DELETE FROM privacy_erasure_tombstones WHERE original_user_id=${replayUserId}`;
  await sql`DELETE FROM users WHERE id=${replayUserId}`;
  await sql`DELETE FROM audit_log WHERE resource='chef_documents' AND resource_id=${docId}`;
  await sql`DELETE FROM audit_log WHERE resource='chefs' AND resource_id=${chefId}`;
  const [gone] = await sql`SELECT id FROM chefs WHERE id=${chefId}`;
  assert("cleanup removed smoke rows", !gone);
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
