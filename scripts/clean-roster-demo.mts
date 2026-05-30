/**
 * Guarded demo-data cleanup — archives obvious TEST-JUNK chef records so the
 * roster supply rail shows realistic names. NON-DESTRUCTIVE: only flips
 * status → 'archived' (reversible by setting it back to 'active'). NEVER deletes.
 *
 *   npx tsx scripts/clean-roster-demo.mts                       # dry-run (default)
 *   CLEAN_ROSTER_DEMO_CONFIRM=1 npx tsx scripts/clean-roster-demo.mts   # apply
 *
 * Guards:
 *   - dry-run by default; prints every row it would touch
 *   - mutates only when CLEAN_ROSTER_DEMO_CONFIRM=1
 *   - never deletes (archive only)
 *   - touches only known junk name patterns (SMOKE*, "Test Chef*", 6+ digit ids)
 *   - refuses if NODE_ENV=production unless ALLOW_PROD_DEMO_CLEANUP=1
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, isNull, ne, or, like, sql } from "drizzle-orm";

const { chefs } = await import("@/lib/db/schema");

const DB_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL(_UNPOOLED) required");

const confirm = process.env.CLEAN_ROSTER_DEMO_CONFIRM === "1";
if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_DEMO_CLEANUP !== "1") {
  console.error("\n⛔ Refusing: NODE_ENV=production without ALLOW_PROD_DEMO_CLEANUP=1.\n");
  process.exit(1);
}

const db = drizzle(neon(DB_URL));

/** Known junk-name patterns only — never a broad match. */
const junk = or(
  like(chefs.fullName, "SMOKE%"),
  like(chefs.fullName, "Test Chef%"),
  sql`${chefs.fullName} ~ '[0-9]{6,}'`,
);

async function run() {
  const targets = await db
    .select({ id: chefs.id, fullName: chefs.fullName, status: chefs.status })
    .from(chefs)
    .where(and(isNull(chefs.deletedAt), ne(chefs.status, "archived"), junk!));

  console.log(`\nJunk chef records (status ≠ archived, matching SMOKE* / "Test Chef*" / 6+ digit id):`);
  if (targets.length === 0) {
    console.log("  (none — nothing to clean)\n");
    process.exit(0);
  }
  for (const t of targets) console.log(`  • ${t.fullName}  [status=${t.status}]`);

  if (!confirm) {
    console.log(`\nDRY-RUN — no changes made. ${targets.length} record(s) WOULD be archived.`);
    console.log("Re-run with CLEAN_ROSTER_DEMO_CONFIRM=1 to apply (status → 'archived'; never deletes).\n");
    process.exit(0);
  }

  let n = 0;
  for (const t of targets) {
    await db.update(chefs).set({ status: "archived", updatedAt: new Date() }).where(eq(chefs.id, t.id));
    console.log(`  archived: ${t.fullName}`);
    n++;
  }
  console.log(`\n✓ Archived ${n} junk chef(s). Reversible: UPDATE chefs SET status='active' WHERE id=...\n`);
}

run().catch((e) => {
  console.error("\n✗ cleanup failed:", e);
  process.exit(1);
});
