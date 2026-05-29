/**
 * withTx atomicity smoke — proves a mutation and its audit row commit/roll back
 * together (interactive tx, Neon WebSocket). Needs DB env:
 *
 *     npx tsx scripts/smoke-tx-atomicity.mts
 *
 * Uses `error_log` as a throwaway "mutation" table (uniquely-marked rows, cleaned
 * up) and `audit_log` as the audit target. Case B forces the AUDIT insert to fail
 * via a bad FK (userId → non-existent user) so the real failure mode is exercised.
 * Self-cleaning. Safe to re-run.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const { withTx } = await import("@/lib/db/tx");
const { recordAuditCore } = await import("@/lib/audit");
const { db } = await import("@/lib/db/client");
const { auditLog, errorLog } = await import("@/lib/db/schema");
const { eq } = await import("drizzle-orm");

const MARK = `TX_SMOKE_${crypto.randomUUID()}`;
const OK_ACTION = `smoke.tx_ok.${MARK}`;

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log("  ✓", name);
    pass++;
  } else {
    console.log("  ✗", name, detail ? `— ${detail}` : "");
    fail++;
  }
}

async function mutCount(): Promise<number> {
  const rows = await db
    .select({ id: errorLog.id })
    .from(errorLog)
    .where(eq(errorLog.message, MARK));
  return rows.length;
}
async function auditCount(): Promise<number> {
  const rows = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(eq(auditLog.action, OK_ACTION));
  return rows.length;
}

console.log("=== withTx atomicity smoke ===\n");

// A. mutation then a THROWN error where the audit would go → rollback.
try {
  await withTx(async (tx) => {
    await tx.insert(errorLog).values({ message: MARK });
    throw new Error("smoke: forced throw after mutation");
  });
} catch {
  /* expected */
}
assert("A: thrown error rolls back the mutation", (await mutCount()) === 0);

// B. mutation then the AUDIT insert itself fails (bad FK) → rollback.
try {
  await withTx(async (tx) => {
    await tx.insert(errorLog).values({ message: MARK });
    await recordAuditCore(
      { userId: crypto.randomUUID(), action: OK_ACTION, resource: "smoke" }, // FK violation
      tx,
    );
  });
} catch {
  /* expected */
}
assert("B: failing audit insert rolls back the mutation", (await mutCount()) === 0);

// C. success → mutation + audit BOTH committed.
await withTx(async (tx) => {
  const [row] = await tx
    .insert(errorLog)
    .values({ message: MARK })
    .returning({ id: errorLog.id });
  await recordAuditCore(
    { action: OK_ACTION, resource: "smoke", resourceId: row.id, after: { _smoke: MARK } },
    tx,
  );
});
assert("C: success commits the mutation", (await mutCount()) === 1);
assert("C: success commits the audit row", (await auditCount()) === 1);

// D. a fresh withTx still connects (prior pools ended cleanly — no leak/poison).
const d = await withTx(async (tx) => {
  await tx.select({ id: errorLog.id }).from(errorLog).limit(1);
  return "ok";
});
assert("D: a second withTx connects after prior pool.end()", d === "ok");

// cleanup
await db.delete(errorLog).where(eq(errorLog.message, MARK));
await db.delete(auditLog).where(eq(auditLog.action, OK_ACTION));
assert("cleanup: no smoke rows left", (await mutCount()) === 0 && (await auditCount()) === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
