/**
 * Chef & klant pattern-intel smoke — proves getChefPatterns / getClientPatterns
 * compute the relationship + pattern layer correctly:
 *   - day-of-week histogram (Mon-first, Amsterdam tz),
 *   - role mix ordered by frequency,
 *   - per-klant earnings (FINAL hours) + lifetime/30d payout,
 *   - the full repeat-chef list (≥2 shifts).
 *
 *     npx tsx scripts/smoke-intel.mts
 *
 * Throwaway user/client/chef/shifts/hours, far-future, torn down in finally.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { db } = await import("@/lib/db/client");
const {
  getChefPatterns,
  getClientPatterns,
  getPlatformIntelKpis,
  getChefDeclineSignals,
  getChefIntelSnapshot,
  getClientIntelSnapshot,
  getMatchIntel,
  saveMatchIntel,
} = await import("@/lib/domain/intel");
const { chefs, clients, placements, shiftHours, shifts, users } = await import("@/lib/db/schema");
const { and, eq, inArray } = await import("drizzle-orm");

const MARK = `INTEL_SMOKE_${crypto.randomUUID()}`;
const HOUR = 3_600_000;

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

let userId = "";
let clientId = "";
let chefId = "";
const extraChefIds: string[] = []; // chef2 (daypart) + chef3 (empty snapshot)

async function makeUnit(opts: { startsAt: Date; role: "chef_de_partie" | "sous_chef" }): Promise<void> {
  const [s] = await db
    .insert(shifts)
    .values({
      clientId,
      startsAt: opts.startsAt,
      endsAt: new Date(opts.startsAt.getTime() + 4 * HOUR),
      roleNeeded: opts.role,
      headcount: 1,
      status: "open",
      notes: MARK,
    })
    .returning({ id: shifts.id });
  const [p] = await db
    .insert(placements)
    .values({ shiftId: s.id, chefId, status: "completed" })
    .returning({ id: placements.id });
  await db.insert(shiftHours).values({
    placementId: p.id,
    shiftId: s.id,
    chefId,
    clientId,
    startedAt: opts.startsAt,
    endedAt: new Date(opts.startsAt.getTime() + 240 * 60_000),
    breakMinutes: 0,
    workedMinutes: 240, // 4h
    chefRateCents: 3000, // €30/u → €120/shift = 12000c
    clientRateCents: 5000,
    status: "admin_approved",
    adminApprovedAt: new Date(),
  });
}

try {
  console.log("=== chef & klant pattern-intel smoke ===\n");

  const [u] = await db.insert(users).values({ email: `${MARK}@smoke.invalid`.toLowerCase() }).returning({ id: users.id });
  userId = u.id;
  const [cl] = await db.insert(clients).values({ companyName: `${MARK} BV`, userId }).returning({ id: clients.id });
  clientId = cl.id;
  const [ch] = await db.insert(chefs).values({ fullName: `${MARK} Chef`, status: "active" }).returning({ id: chefs.id });
  chefId = ch.id;

  // 2 shifts on one weekday (chef_de_partie), 1 on the next day (sous_chef). Noon UTC.
  await makeUnit({ startsAt: new Date("2099-06-06T12:00:00Z"), role: "chef_de_partie" });
  await makeUnit({ startsAt: new Date("2099-06-06T12:00:00Z"), role: "chef_de_partie" });
  await makeUnit({ startsAt: new Date("2099-06-07T12:00:00Z"), role: "sous_chef" });

  // ---- chef patterns ----
  const cp = await getChefPatterns(chefId);
  const daySum = cp.preferredDays.reduce((s, d) => s + d.count, 0);
  assert("chef: day histogram sums to 3", daySum === 3, `=${daySum}`);
  assert("chef: exactly one weekday has 2", cp.preferredDays.filter((d) => d.count === 2).length === 1);
  assert("chef: exactly one weekday has 1", cp.preferredDays.filter((d) => d.count === 1).length === 1);
  assert("chef: busiest day label set", cp.busiestDayLabel != null, String(cp.busiestDayLabel));
  assert("chef: topDaypart = lunch (14:00 Amsterdam)", cp.topDaypart === "lunch", String(cp.topDaypart));
  assert("chef: roleMix top = chef_de_partie (2)", cp.roleMix[0]?.role === "chef_de_partie" && cp.roleMix[0]?.count === 2, JSON.stringify(cp.roleMix));
  assert("chef: 1 klant in earnings, 36000c over 3 shifts", cp.clientEarnings.length === 1 && cp.clientEarnings[0].cents === 36000 && cp.clientEarnings[0].shifts === 3, JSON.stringify(cp.clientEarnings));
  assert("chef: totalEarned = 36000c", cp.totalEarnedCents === 36000, `=${cp.totalEarnedCents}`);
  assert("chef: earned30d = 36000c", cp.earned30dCents === 36000, `=${cp.earned30dCents}`);

  // ---- klant patterns ----
  const kp = await getClientPatterns(clientId);
  assert("klant: booking histogram sums to 3", kp.bookingDays.reduce((s, d) => s + d.count, 0) === 3);
  assert("klant: roleMix top = chef_de_partie (2)", kp.roleMix[0]?.role === "chef_de_partie" && kp.roleMix[0]?.count === 2, JSON.stringify(kp.roleMix));
  assert("klant: repeat chef listed with 3 shifts", kp.repeatChefs.length === 1 && kp.repeatChefs[0].count === 3, JSON.stringify(kp.repeatChefs));

  // ---- decline signals + AI snapshots (Phase 1C/1D) ----
  const [rejShift] = await db
    .insert(shifts)
    .values({
      clientId,
      startsAt: new Date("2099-08-01T12:00:00Z"),
      endsAt: new Date("2099-08-01T16:00:00Z"),
      roleNeeded: "chef_de_partie",
      headcount: 1,
      status: "open",
      notes: MARK,
    })
    .returning({ id: shifts.id });
  await db.insert(placements).values({ shiftId: rejShift.id, chefId, status: "rejected", declineReason: "te_ver" });
  await db.update(chefs).set({ intel: { bestUsedFor: "ontbijt" } }).where(eq(chefs.id, chefId));
  await db.update(clients).set({ intel: { bestChefType: "kalm" } }).where(eq(clients.id, clientId));

  const ds = await getChefDeclineSignals(chefId);
  assert("decline signals: te_ver count 1 (label 'Te ver')", ds.length === 1 && ds[0].reason === "te_ver" && ds[0].count === 1 && ds[0].label === "Te ver", JSON.stringify(ds));

  const snap = await getChefIntelSnapshot(chefId);
  assert("chef snapshot: brein.bestUsedFor = 'ontbijt'", snap?.brein?.bestUsedFor === "ontbijt", JSON.stringify(snap?.brein));
  assert("chef snapshot: bundles patterns + decline signals", (snap?.patterns.preferredDays.length ?? 0) === 7 && (snap?.declineSignals.length ?? 0) === 1, JSON.stringify({ d: snap?.declineSignals }));
  assert("chef snapshot: daysSinceLastWorked is a number", typeof snap?.daysSinceLastWorked === "number");

  const csnap = await getClientIntelSnapshot(clientId);
  assert("klant snapshot: brein.bestChefType = 'kalm' + patterns", csnap?.brein?.bestChefType === "kalm" && csnap?.patterns.bookingDays.length === 7, JSON.stringify(csnap?.brein));

  // ---- HARDENING: edge cases ----
  // (A) Decline aggregation: more reasons → ordered by count, labelled.
  for (const day of ["2099-08-02", "2099-08-03"]) {
    const [s] = await db
      .insert(shifts)
      .values({ clientId, startsAt: new Date(`${day}T12:00:00Z`), endsAt: new Date(`${day}T16:00:00Z`), roleNeeded: "chef_de_partie", headcount: 1, status: "open", notes: MARK })
      .returning({ id: shifts.id });
    await db.insert(placements).values({ shiftId: s.id, chefId, status: "rejected", declineReason: day.endsWith("02") ? "te_ver" : "tarief" });
  }
  const ds2 = await getChefDeclineSignals(chefId);
  assert(
    "decline: te_ver(2) ranks before tarief(1)",
    ds2.length === 2 && ds2[0].reason === "te_ver" && ds2[0].count === 2 && ds2[1].reason === "tarief" && ds2[1].count === 1,
    JSON.stringify(ds2),
  );

  // (B) Daypart boundary: 18:00 UTC = 20:00 Amsterdam → diner (a 2nd chef).
  const [ch2] = await db.insert(chefs).values({ fullName: `${MARK} DinerChef`, status: "active" }).returning({ id: chefs.id });
  extraChefIds.push(ch2.id);
  for (const day of ["2099-09-01", "2099-09-02"]) {
    const [s] = await db
      .insert(shifts)
      .values({ clientId, startsAt: new Date(`${day}T18:00:00Z`), endsAt: new Date(`${day}T23:00:00Z`), roleNeeded: "sous_chef", headcount: 1, status: "open", notes: MARK })
      .returning({ id: shifts.id });
    await db.insert(placements).values({ shiftId: s.id, chefId: ch2.id, status: "completed" });
  }
  const cp2 = await getChefPatterns(ch2.id);
  assert("daypart: 20:00 Amsterdam → diner", cp2.topDaypart === "diner", String(cp2.topDaypart));

  // (C) A fresh chef (no data): snapshot is non-null but empty, never crashes.
  const [ch3] = await db.insert(chefs).values({ fullName: `${MARK} FreshChef`, status: "active" }).returning({ id: chefs.id });
  extraChefIds.push(ch3.id);
  const empty = await getChefIntelSnapshot(ch3.id);
  assert(
    "empty chef: snapshot non-null, brein null, no declines, no last-worked, zeroed days",
    empty != null &&
      empty.brein === null &&
      empty.declineSignals.length === 0 &&
      empty.daysSinceLastWorked === null &&
      empty.patterns.topDaypart === null &&
      empty.patterns.preferredDays.every((d) => d.count === 0),
    JSON.stringify({ b: empty?.brein, d: empty?.declineSignals, last: empty?.daysSinceLastWorked, dp: empty?.patterns.topDaypart }),
  );

  // ---- match-intel (Phase 4/5): pair-memory partial upsert + thumbs ----
  // (1) AI writes the why-field first.
  await saveMatchIntel({ chefId, clientId, updatedBy: userId, aiWhyWorks: "rustig, past bij hun gasten" });
  let mi = await getMatchIntel(chefId, clientId);
  assert("match: completedShifts = 3 (derived history)", mi.history.completedShifts === 3, String(mi.history.completedShifts));
  assert("match: aiWhyWorks stored", mi.pair?.aiWhyWorks === "rustig, past bij hun gasten", JSON.stringify(mi.pair));
  assert("match: note null after AI-only save", mi.pair?.note === null, JSON.stringify(mi.pair));

  // (2) Maarten saves note + wouldRehire — partial upsert must PRESERVE aiWhyWorks.
  await saveMatchIntel({ chefId, clientId, updatedBy: userId, note: "klant vroeg naar hem", wouldRehire: true });
  mi = await getMatchIntel(chefId, clientId);
  assert("match: note saved", mi.pair?.note === "klant vroeg naar hem", JSON.stringify(mi.pair));
  assert("match: wouldRehire = true", mi.pair?.wouldRehire === true, JSON.stringify(mi.pair));
  assert("match: partial upsert preserved aiWhyWorks", mi.pair?.aiWhyWorks === "rustig, past bij hun gasten", JSON.stringify(mi.pair));

  // (3) post-shift thumb: chef_return_signal on completed placements → thumbs.up.
  await db.update(placements).set({ chefReturnSignal: true }).where(and(eq(placements.chefId, chefId), eq(placements.status, "completed")));
  mi = await getMatchIntel(chefId, clientId);
  assert("match: thumbs.up reflects chef_return_signal (3/0)", mi.thumbs.up === 3 && mi.thumbs.down === 0, JSON.stringify(mi.thumbs));

  // Platform intel KPIs — global (counts real dev data); just verify SQL runs + shape.
  const kpis = await getPlatformIntelKpis();
  assert("platform kpis: activeChefs30d ≥ 0", typeof kpis.activeChefs30d === "number" && kpis.activeChefs30d >= 0, JSON.stringify(kpis));
  assert("platform kpis: activeKlanten30d ≥ 0", typeof kpis.activeKlanten30d === "number" && kpis.activeKlanten30d >= 0);
  assert("platform kpis: avgSigningHours is number|null", kpis.avgSigningHours === null || typeof kpis.avgSigningHours === "number", JSON.stringify(kpis));
} finally {
  if (clientId) {
    await db.delete(shiftHours).where(eq(shiftHours.clientId, clientId));
  }
  if (chefId) await db.delete(placements).where(eq(placements.chefId, chefId));
  if (clientId) await db.delete(shifts).where(eq(shifts.clientId, clientId)); // cascades extra chefs' placements
  if (chefId) await db.delete(chefs).where(eq(chefs.id, chefId));
  if (extraChefIds.length) await db.delete(chefs).where(inArray(chefs.id, extraChefIds));
  if (clientId) await db.delete(clients).where(eq(clients.id, clientId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
