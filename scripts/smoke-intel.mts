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
const { getChefPatterns, getClientPatterns } = await import("@/lib/domain/intel");
const { chefs, clients, placements, shiftHours, shifts, users } = await import("@/lib/db/schema");
const { eq } = await import("drizzle-orm");

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
  assert("chef: roleMix top = chef_de_partie (2)", cp.roleMix[0]?.role === "chef_de_partie" && cp.roleMix[0]?.count === 2, JSON.stringify(cp.roleMix));
  assert("chef: 1 klant in earnings, 36000c over 3 shifts", cp.clientEarnings.length === 1 && cp.clientEarnings[0].cents === 36000 && cp.clientEarnings[0].shifts === 3, JSON.stringify(cp.clientEarnings));
  assert("chef: totalEarned = 36000c", cp.totalEarnedCents === 36000, `=${cp.totalEarnedCents}`);
  assert("chef: earned30d = 36000c", cp.earned30dCents === 36000, `=${cp.earned30dCents}`);

  // ---- klant patterns ----
  const kp = await getClientPatterns(clientId);
  assert("klant: booking histogram sums to 3", kp.bookingDays.reduce((s, d) => s + d.count, 0) === 3);
  assert("klant: roleMix top = chef_de_partie (2)", kp.roleMix[0]?.role === "chef_de_partie" && kp.roleMix[0]?.count === 2, JSON.stringify(kp.roleMix));
  assert("klant: repeat chef listed with 3 shifts", kp.repeatChefs.length === 1 && kp.repeatChefs[0].count === 3, JSON.stringify(kp.repeatChefs));
} finally {
  if (clientId) {
    await db.delete(shiftHours).where(eq(shiftHours.clientId, clientId));
  }
  if (chefId) await db.delete(placements).where(eq(placements.chefId, chefId));
  if (clientId) await db.delete(shifts).where(eq(shifts.clientId, clientId));
  if (chefId) await db.delete(chefs).where(eq(chefs.id, chefId));
  if (clientId) await db.delete(clients).where(eq(clients.id, clientId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
