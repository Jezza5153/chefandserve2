/**
 * Execution smoke for the klant-blacklist hard-gate (Batch A).
 *
 * The Opus review found the original gate had two open seams (emergency claim,
 * confirm) and a dead-end override. This smoke RUNS all four seams against the
 * dev DB with throwaway rows — the routing eval never executes a tool and
 * type-check can't see a missing string branch, so only execution proves this.
 *
 *   npx tsx --env-file=.env.local scripts/smoke-blacklist-gate.ts
 *
 * Refuses to run against prod. Creates its own rows, cleans them up (also on
 * failure). Flags are forced in-process BEFORE the env module parses.
 */
process.env.KLANT_BLACKLIST_GATE_ENABLED = "true";
process.env.EMERGENCY_CLAIM_ENABLED = "true";
process.env.CHEF_OPEN_SHIFTS_ENABLED = "true";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (url.includes("ep-icy-scene")) {
    console.error("REFUSING: smoke creates throwaway rows — dev only.");
    process.exit(2);
  }

  const { db } = await import("@/lib/db/client");
  const { chefs, clients, placements, shifts, users } = await import("@/lib/db/schema");
  const { proposePlacement } = await import("@/lib/domain/matching");
  const { claimEmergencyShift, listOpenShiftsForChef } = await import("@/lib/domain/shift-interests");
  const { transitionPlacement } = await import("@/lib/domain/placement-transition");
  const { eq, inArray } = await import("drizzle-orm");

  const [actor] = await db.select({ id: users.id }).from(users).limit(1);
  if (!actor) { console.error("dev DB heeft geen users-rij (FK voor proposedBy)"); process.exit(2); }

  let pass = 0;
  let fail = 0;
  const ok = (name: string, cond: boolean, extra?: unknown) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.error(`  ✗ ${name}`, extra ?? ""); }
  };

  const suffix = `smoke-blgate-${Date.now()}`;
  const startsAt = new Date(Date.now() + 6 * 3600_000);
  const endsAt = new Date(Date.now() + 14 * 3600_000);

  const [chef] = await db
    .insert(chefs)
    .values({ fullName: `SMOKE Geblokkeerde Chef ${suffix}`, status: "active", availableForEmergency: true })
    .returning({ id: chefs.id });
  const [klant] = await db
    .insert(clients)
    .values({ companyName: `SMOKE Klant ${suffix}`, status: "active", blockedChefIds: [chef.id] })
    .returning({ id: clients.id });
  const [shift] = await db
    .insert(shifts)
    .values({
      clientId: klant.id, roleNeeded: "chef_de_partie", startsAt, endsAt,
      headcount: 1, status: "open", isEmergency: true, createdBy: null,
    })
    .returning({ id: shifts.id });

  try {
    // 1. propose without override → blocked with the klant reason
    const p1 = await proposePlacement(shift.id, chef.id, { proposedBy: actor.id });
    ok("propose zonder override → blocked", p1.status === "blocked" && "blockers" in p1 && p1.blockers.includes("door deze klant geblokkeerd"), p1);

    // 2. feeder list hides the shift from the blocked chef
    const open = await listOpenShiftsForChef(chef.id);
    ok("open-diensten-lijst verbergt de dienst", !open.some((s) => s.shiftId === shift.id));

    // 3. emergency claim → klant_blocked (never a confirmed insert)
    const c1 = await claimEmergencyShift({ chefId: chef.id, shiftId: shift.id });
    ok("spoedclaim → klant_blocked", !c1.ok && c1.reason === "klant_blocked", c1);
    const rows1 = await db.select({ id: placements.id }).from(placements).where(eq(placements.shiftId, shift.id));
    ok("géén placement-rij na geweigerde claim", rows1.length === 0);

    // 4. propose WITH override-with-reason → proposed (the human escape hatch works)
    const p2 = await proposePlacement(shift.id, chef.id, {
      proposedBy: actor.id,
      override: { overriddenBy: actor.id, reason: "smoke: bewuste uitzondering met reden" },
    });
    ok("propose mét override → proposed", p2.status === "proposed", p2);

    // 5. confirm without a fresh override → blocked at the financial commit
    if (p2.status === "proposed") {
      const t1 = await transitionPlacement({ placementId: p2.placementId, newStatus: "confirmed", actorUserId: actor.id });
      ok("confirm zonder override → blocked", !t1.ok && t1.reason === "blocked", t1);
      const t2 = await transitionPlacement({
        placementId: p2.placementId, newStatus: "confirmed", actorUserId: actor.id,
        override: { overriddenBy: actor.id, reason: "smoke: bevestiging met reden" },
      });
      ok("confirm mét override → ok", t2.ok === true, t2);
    }
  } finally {
    await db.delete(placements).where(eq(placements.shiftId, shift.id));
    await db.delete(shifts).where(eq(shifts.id, shift.id));
    await db.delete(clients).where(eq(clients.id, klant.id));
    await db.delete(chefs).where(inArray(chefs.id, [chef.id]));
  }

  console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
