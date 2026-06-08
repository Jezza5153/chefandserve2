/**
 * Klant draft-leak smoke — proves a planbord CONCEPT never reveals a chef to the
 * klant. Both /client/week and /client/shifts resolve the shown chef with the
 * SAME query — non-draft placements only — and label via getClientShiftLabel.
 * This asserts that filter + the label on the three cases that matter:
 *   A) draft-only shift     → no chef, "Wacht op planning"
 *   B) proposed shift       → chef shown, "Chef voorgesteld"
 *   C) draft + proposed mix → ONLY the proposed chef; the drafted chef is hidden
 *
 *     npx tsx scripts/smoke-klant-week.mts
 *
 * Throwaway user/client/chefs/shifts, torn down in finally. Needs DB env.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { db } = await import("@/lib/db/client");
const { getClientShiftLabel } = await import("@/lib/client-shift-labels");
const { chefs, clients, placements, shifts, users } = await import("@/lib/db/schema");
const { and, eq, inArray, ne } = await import("drizzle-orm");

const MARK = `KLANTWEEK_SMOKE_${crypto.randomUUID()}`;
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
const chefIds: string[] = [];
const shiftIds: string[] = [];

async function makeShift(): Promise<string> {
  const [s] = await db
    .insert(shifts)
    .values({
      clientId,
      startsAt: new Date(Date.now() + 30 * 24 * HOUR),
      endsAt: new Date(Date.now() + 30 * 24 * HOUR + 4 * HOUR),
      roleNeeded: "chef_de_partie",
      headcount: 1,
      status: "open",
      notes: MARK,
    })
    .returning({ id: shifts.id });
  shiftIds.push(s.id);
  return s.id;
}

async function place(shiftId: string, chefId: string, status: "draft" | "proposed"): Promise<void> {
  await db.insert(placements).values({ shiftId, chefId, status });
}

try {
  console.log("=== klant draft-leak smoke ===\n");

  const [u] = await db.insert(users).values({ email: `${MARK}@smoke.invalid`.toLowerCase() }).returning({ id: users.id });
  userId = u.id;
  const [cl] = await db.insert(clients).values({ companyName: `${MARK} BV`, userId }).returning({ id: clients.id });
  clientId = cl.id;
  const [ch1] = await db.insert(chefs).values({ fullName: `${MARK} DraftChef`, status: "active" }).returning({ id: chefs.id });
  const [ch2] = await db.insert(chefs).values({ fullName: `${MARK} ProposedChef`, status: "active" }).returning({ id: chefs.id });
  chefIds.push(ch1.id, ch2.id);

  const shiftA = await makeShift(); // draft only
  const shiftB = await makeShift(); // proposed only
  const shiftC = await makeShift(); // draft + proposed mix
  await place(shiftA, ch1.id, "draft");
  await place(shiftB, ch2.id, "proposed");
  await place(shiftC, ch1.id, "draft");
  await place(shiftC, ch2.id, "proposed");

  // THE query both klant pages run to resolve the shown chef.
  const visible = await db
    .select({ shiftId: placements.shiftId, status: placements.status, chefName: chefs.fullName })
    .from(placements)
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .where(and(inArray(placements.shiftId, [shiftA, shiftB, shiftC]), ne(placements.status, "draft")));

  const forShift = (id: string) => visible.filter((r) => r.shiftId === id);

  assert("A: draft-only shift reveals NO chef", forShift(shiftA).length === 0, JSON.stringify(forShift(shiftA)));
  assert("B: proposed shift reveals the chef", forShift(shiftB).some((r) => r.chefName.includes("ProposedChef")));
  const cRows = forShift(shiftC);
  assert("C: mixed shift reveals only the proposed chef", cRows.length === 1 && cRows[0].chefName.includes("ProposedChef"), JSON.stringify(cRows));
  assert("C: the drafted chef is NEVER returned", !cRows.some((r) => r.chefName.includes("DraftChef")));

  // Labels: a draft-only shift reads as "wacht op planning" (no chef in the copy).
  const labelA = getClientShiftLabel({ shiftStatus: "open", hasPlacement: false, placementStatus: null });
  assert("A: label is 'Wacht op planning'", labelA.humanStatus === "Wacht op planning", labelA.humanStatus);
  const labelB = getClientShiftLabel({ shiftStatus: "open", hasPlacement: true, placementStatus: "proposed" });
  assert("B: label is 'Chef voorgesteld'", labelB.humanStatus === "Chef voorgesteld", labelB.humanStatus);
} finally {
  if (shiftIds.length) await db.delete(shifts).where(inArray(shifts.id, shiftIds)); // cascades placements
  if (chefIds.length) await db.delete(chefs).where(inArray(chefs.id, chefIds));
  if (clientId) await db.delete(clients).where(eq(clients.id, clientId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
