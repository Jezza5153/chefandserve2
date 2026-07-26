/**
 * Smoke: the "Chef valt uit" domain path RUNS and behaves.
 *
 * The server action is a thin wrapper; the load-bearing pieces are
 * transitionPlacement (atomic cancel with expectedStatus guard + shift-status
 * recompute) and recordChefEvent. tsc validates neither the SQL nor the state
 * machine, so this creates a disposable shift+placement on DEV, runs the exact
 * transitions the action runs, and asserts the observable state — then cleans up
 * in a finally block.
 *
 *   npx tsx --env-file=.env.local scripts/smoke-chef-valt-uit.ts
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefEvents, chefs, clients, placements, shifts, users } from "@/lib/db/schema";
import { recordChefEvent } from "@/lib/chef-events";
import { transitionPlacement } from "@/lib/domain/placement-transition";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "?";
  if (host.includes("ep-icy-scene")) { console.error("REFUSING: production. Dev only."); process.exit(2); }
  console.log(`=== chef-valt-uit smoke (${host}) ===\n`);

  const [chef] = await db.select({ id: chefs.id }).from(chefs).limit(1);
  const [client] = await db.select({ id: clients.id }).from(clients).limit(1);
  // audit_log.user_id is a real FK — the actor must exist.
  const [actor] = await db.select({ id: users.id }).from(users).limit(1);
  if (!chef || !client || !actor) { console.log("  – dev DB has no chef/client/user; cannot smoke"); process.exit(1); }

  const start = new Date(Date.now() + 6 * 3600e3);
  const end = new Date(Date.now() + 10 * 3600e3);
  let shiftId: string | null = null;
  let placementId: string | null = null;

  try {
    const [sh] = await db
      .insert(shifts)
      .values({ clientId: client.id, startsAt: start, endsAt: end, roleNeeded: "sous_chef", status: "filled", headcount: 1, notes: "SMOKE chef-valt-uit — disposable" })
      .returning({ id: shifts.id });
    shiftId = sh!.id;
    const [pl] = await db
      .insert(placements)
      .values({ shiftId: sh!.id, chefId: chef.id, status: "confirmed", confirmedAt: new Date() })
      .returning({ id: placements.id });
    placementId = pl!.id;

    console.log("the cancel transition:");
    const res = await transitionPlacement({
      placementId: pl!.id,
      newStatus: "cancelled",
      actorUserId: actor.id,
      expectedStatus: "confirmed",
    });
    ok("transition succeeds and reports changed", res.ok && "changed" in res && res.changed === true);

    const [after] = await db
      .select({ status: placements.status, cancelledAt: placements.cancelledAt })
      .from(placements).where(eq(placements.id, pl!.id));
    ok("placement is cancelled with cancelledAt", after?.status === "cancelled" && after.cancelledAt != null);

    const [shAfter] = await db.select({ status: shifts.status }).from(shifts).where(eq(shifts.id, sh!.id));
    ok("shift recomputed away from 'filled' (slot is open again)", shAfter?.status !== "filled",
       `shift status is ${shAfter?.status}`);

    console.log("\nidempotency — the double-click and the stale click:");
    const again = await transitionPlacement({
      placementId: pl!.id, newStatus: "cancelled", actorUserId: actor.id, expectedStatus: "confirmed",
    });
    ok("re-fire is a clean no-op (terminal guard)", again.ok && "changed" in again && again.changed === false);

    console.log("\nthe reason event (feeds reliability + the cancellations metric):");
    await recordChefEvent({
      chefId: chef.id, eventType: "shift_cancelled_by_chef",
      entityType: "placement", entityId: pl!.id,
      payload: { reason: "ziek", recordedBy: "office" },
    });
    const ev = await db
      .select({ id: chefEvents.id, payload: chefEvents.payload })
      .from(chefEvents)
      .where(and(eq(chefEvents.chefId, chef.id), eq(chefEvents.entityId, pl!.id)));
    ok("chef event recorded with the reason payload", ev.length === 1 && (ev[0]!.payload as { reason?: string })?.reason === "ziek");
    for (const e of ev) await db.delete(chefEvents).where(eq(chefEvents.id, e.id));
  } finally {
    if (placementId) await db.delete(placements).where(eq(placements.id, placementId));
    if (shiftId) await db.delete(shifts).where(eq(shifts.id, shiftId));
    console.log("\n  ↳ disposable shift + placement removed");
  }

  console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
