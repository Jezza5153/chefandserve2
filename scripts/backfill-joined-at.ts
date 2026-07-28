/**
 * Mining round 3 — replace the placeholder `joinedAt` on migrated chefs.
 *
 *   scripts/with-prod-env.sh scripts/backfill-joined-at.ts \
 *     --chefs=~/Downloads/shiftmanager-extract/sm-chefs.json [--execute]
 *
 * WHY. `import-medewerkers.ts` never set joinedAt, so all 204 migrated chefs default to
 * their IMPORT date. Consequences that are live right now: ChefCard shows "0 jaar bij ons"
 * for a chef we have worked with since 2022, and every jubileum would fire on the same day
 * (currently suppressed by a marker in people-moments.ts — this backfill is what makes
 * that suppression unnecessary for the chefs it can date).
 *
 * THE SOURCE. The oldest dated line in a chef's ShiftManager communicatie card is the
 * earliest proof we have that the relationship existed. It is a LOWER BOUND, not the exact
 * signing date — a chef may have started before anyone wrote a note. That is honest and it
 * is strictly better than "joined the day we migrated".
 *
 * Only moves joinedAt BACKWARDS, and only when the current value looks like the import
 * placeholder (on/after 2026-07-26). An owner-corrected date is never overwritten.
 */
import { readFileSync } from "node:fs";

import { eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import { recordAuditCore } from "@/lib/audit";

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const file = args.find((a) => a.startsWith("--chefs="))?.slice(8)?.replace(/^~/, process.env.HOME ?? "");
if (!file) {
  console.error("Usage: backfill-joined-at.ts --chefs=sm-chefs.json [--execute]");
  process.exit(2);
}

/** The migration window: anything from this date on is the import placeholder, not a fact. */
const PLACEHOLDER_FROM = new Date("2026-07-26T00:00:00Z");

type SmChef = { email?: string; notes?: { date: string }[] };

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "?";
  console.log(`host: ${host} · mode: ${EXECUTE ? "EXECUTE" : "dry-run"}`);
  if (EXECUTE && !host.includes("ep-icy-scene")) {
    console.error("REFUSING --execute: hoort op prod (ep-icy-scene).");
    process.exit(2);
  }

  const oldestByEmail = new Map<string, string>();
  for (const c of JSON.parse(readFileSync(file!, "utf-8")) as SmChef[]) {
    if (!c.email || !c.notes?.length) continue;
    const dates = c.notes.map((n) => n.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (dates.length) oldestByEmail.set(c.email.toLowerCase(), dates[0]!);
  }

  const rows = await db
    .select({ id: chefs.id, fullName: chefs.fullName, email: chefs.email, joinedAt: chefs.joinedAt })
    .from(chefs)
    .where(isNull(chefs.deletedAt));

  let updated = 0, noSource = 0, keptOwner = 0;
  let oldest = "9999";
  for (const c of rows) {
    const found = oldestByEmail.get((c.email ?? "").toLowerCase());
    if (!found) { noSource++; continue; }
    const current = new Date(c.joinedAt);
    // Only touch the placeholder, and only ever move the date backwards.
    if (current < PLACEHOLDER_FROM) { keptOwner++; continue; }
    const next = new Date(`${found}T00:00:00Z`);
    if (next >= current) { keptOwner++; continue; }

    if (found < oldest) oldest = found;
    updated++;
    if (EXECUTE) {
      await db.update(chefs).set({ joinedAt: next, updatedAt: new Date() }).where(eq(chefs.id, c.id));
    }
  }

  console.log(`\n${EXECUTE ? "bijgewerkt" : "ZOU bijwerken"}: ${updated} chefs · oudste startdatum: ${oldest === "9999" ? "-" : oldest}`);
  console.log(`  geen gedateerde notitie: ${noSource} · eigen/al eerdere datum behouden: ${keptOwner}`);
  console.log("  NB: dit is de oudste NOTITIE-datum — een ondergrens, geen contractdatum.");

  if (EXECUTE && updated > 0) {
    await recordAuditCore({
      userId: null as never,
      action: "chefs.backfill_joined_at",
      resource: "chefs",
      resourceId: "shiftmanager-oldest-note",
      after: { updated, oldest, source: "oudste gedateerde communicatie-notitie" },
    }).catch((e) => console.error("audit failed (import ok):", e));
  }
}

main().then(() => process.exit(0));
