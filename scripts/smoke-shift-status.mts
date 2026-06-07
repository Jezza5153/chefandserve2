/**
 * Shift status lifecycle smoke (P3/P4) — proves recomputeShiftStatus derives the
 * right shifts.status from live placements + end time, and that
 * cancelShiftAndPlacements cancels the shift + its live placements atomically.
 *
 *     npx tsx scripts/smoke-shift-status.mts
 *
 * Creates a throwaway client + chef + shift + placements (uniquely marked),
 * walks the transitions, then deletes everything it made. Self-cleaning, safe to
 * re-run. Needs DB env (.env.local).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const { db } = await import("@/lib/db/client");
const { withTx } = await import("@/lib/db/tx");
const { recomputeShiftStatus, cancelShiftAndPlacements } = await import(
  "@/lib/domain/shift-status"
);
const { chefs, clients, placements, shifts } = await import("@/lib/db/schema");
const { eq } = await import("drizzle-orm");

const MARK = `SHIFT_STATUS_SMOKE_${crypto.randomUUID()}`;

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

const HOUR = 3_600_000;

// Fixtures we create, torn down in finally.
let clientId = "";
let chefAId = "";
let chefBId = "";

async function makeShift(opts: {
  endsInMs: number;
  headcount: number;
  status?: "request" | "open" | "filled" | "completed" | "cancelled";
}): Promise<string> {
  const startsAt = new Date(Date.now() + opts.endsInMs - HOUR);
  const endsAt = new Date(Date.now() + opts.endsInMs);
  const [row] = await db
    .insert(shifts)
    .values({
      clientId,
      startsAt,
      endsAt,
      roleNeeded: "chef_de_partie",
      headcount: opts.headcount,
      status: opts.status ?? "open",
      notes: MARK,
    })
    .returning({ id: shifts.id });
  return row.id;
}

async function addPlacement(
  shiftId: string,
  chefId: string,
  status: "proposed" | "accepted" | "rejected" | "confirmed" | "cancelled" | "completed",
): Promise<void> {
  await db.insert(placements).values({
    shiftId,
    chefId,
    status,
    // confirmedAt is only meaningful for confirmed/completed; set it so the
    // "notify confirmed chefs" filter has realistic data.
    confirmedAt: status === "confirmed" || status === "completed" ? new Date() : null,
    completedAt: status === "completed" ? new Date() : null,
  });
}

try {
  console.log("=== shift-status lifecycle smoke ===\n");

  // ---- fixtures ----
  const [cl] = await db
    .insert(clients)
    .values({ companyName: `${MARK} BV` })
    .returning({ id: clients.id });
  clientId = cl.id;
  const [ca] = await db
    .insert(chefs)
    .values({ fullName: `${MARK} ChefA` })
    .returning({ id: chefs.id });
  chefAId = ca.id;
  const [cb] = await db
    .insert(chefs)
    .values({ fullName: `${MARK} ChefB` })
    .returning({ id: chefs.id });
  chefBId = cb.id;

  // ---- 1. no confirmed placements, not ended → open ----
  {
    const sid = await makeShift({ endsInMs: 2 * HOUR, headcount: 1 });
    await addPlacement(sid, chefAId, "proposed");
    const next = await recomputeShiftStatus(sid);
    assert("proposed only → open", next === "open", String(next));
  }

  // ---- 2. confirmed >= headcount(1) → filled ----
  {
    const sid = await makeShift({ endsInMs: 2 * HOUR, headcount: 1 });
    await addPlacement(sid, chefAId, "confirmed");
    const next = await recomputeShiftStatus(sid);
    assert("1 confirmed, headcount 1 → filled", next === "filled", String(next));
  }

  // ---- 3. headcount 2, only 1 confirmed → still open ----
  {
    const sid = await makeShift({ endsInMs: 2 * HOUR, headcount: 2 });
    await addPlacement(sid, chefAId, "confirmed");
    await addPlacement(sid, chefBId, "proposed");
    const next = await recomputeShiftStatus(sid);
    assert("1/2 confirmed → open", next === "open", String(next));
  }

  // ---- 4. ended + all non-cancelled completed → completed ----
  {
    const sid = await makeShift({ endsInMs: -2 * HOUR, headcount: 1 }); // ended 2h ago
    await addPlacement(sid, chefAId, "completed");
    await addPlacement(sid, chefBId, "cancelled"); // cancelled is ignored
    const next = await recomputeShiftStatus(sid);
    assert("ended + all completed → completed", next === "completed", String(next));
  }

  // ---- 5. ended but a confirmed (not completed) remains → filled, NOT completed ----
  {
    const sid = await makeShift({ endsInMs: -2 * HOUR, headcount: 1 });
    await addPlacement(sid, chefAId, "confirmed");
    const next = await recomputeShiftStatus(sid);
    assert("ended + confirmed-not-completed → filled", next === "filled", String(next));
  }

  // ---- 6. ended with ZERO non-cancelled placements → open (nobody worked it) ----
  {
    const sid = await makeShift({ endsInMs: -2 * HOUR, headcount: 1 });
    await addPlacement(sid, chefAId, "cancelled");
    const next = await recomputeShiftStatus(sid);
    assert("ended + only cancelled → open (not completed)", next === "open", String(next));
  }

  // ---- 7. cancelled stays cancelled ----
  {
    const sid = await makeShift({ endsInMs: -2 * HOUR, headcount: 1, status: "cancelled" });
    await addPlacement(sid, chefAId, "completed");
    const next = await recomputeShiftStatus(sid);
    assert("cancelled override stays cancelled", next === "cancelled", String(next));
  }

  // ---- 8. cancelShiftAndPlacements: flips shift + live placements, idempotent ----
  {
    const sid = await makeShift({ endsInMs: 4 * HOUR, headcount: 2 });
    await addPlacement(sid, chefAId, "confirmed");
    await addPlacement(sid, chefBId, "proposed");

    const first = await withTx((tx) => cancelShiftAndPlacements(sid, "klant afgezegd", tx));
    assert("cancel returns changed=true first time", first.changed === true);

    const [s] = await db
      .select({ status: shifts.status, reason: shifts.cancelledReason })
      .from(shifts)
      .where(eq(shifts.id, sid))
      .limit(1);
    assert("shift now cancelled", s.status === "cancelled", String(s.status));
    assert("cancel reason stored", s.reason === "klant afgezegd", String(s.reason));

    const ps = await db
      .select({ status: placements.status })
      .from(placements)
      .where(eq(placements.shiftId, sid));
    assert(
      "all placements cancelled",
      ps.length === 2 && ps.every((p) => p.status === "cancelled"),
      ps.map((p) => p.status).join(","),
    );

    const second = await withTx((tx) => cancelShiftAndPlacements(sid, "again", tx));
    assert("cancel idempotent → changed=false second time", second.changed === false);

    const post = await recomputeShiftStatus(sid);
    assert("recompute keeps cancelled", post === "cancelled", String(post));
  }

  console.log(`\n  pass: ${pass}\n  fail: ${fail}`);
} finally {
  // ---- teardown (children first; cascade also covers placements) ----
  await db.delete(placements).where(eq(placements.chefId, chefAId));
  await db.delete(placements).where(eq(placements.chefId, chefBId));
  await db.delete(shifts).where(eq(shifts.notes, MARK));
  if (chefAId) await db.delete(chefs).where(eq(chefs.id, chefAId));
  if (chefBId) await db.delete(chefs).where(eq(chefs.id, chefBId));
  if (clientId) await db.delete(clients).where(eq(clients.id, clientId));
}

if (fail > 0) {
  console.log("\nSmoke FAILED ✗");
  process.exit(1);
}
console.log("\nSmoke OK ✓");
process.exit(0);
