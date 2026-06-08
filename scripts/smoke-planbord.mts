/**
 * Planbord draft/publish smoke — proves the concept→publish spine is properly
 * wired: a draft is INVISIBLE (chef pipeline + ICS feed) and IGNORED by
 * shift-status; publish flips draft→proposed and RE-VALIDATES away a concept
 * that would double-book; and removeDraft can never touch a published row.
 *
 *     npx tsx scripts/smoke-planbord.mts
 *
 * Throwaway client + chef (email=null, so publish sends NO mail) + shifts, all
 * marked + torn down in finally. Needs DB env (.env.local = dev branch).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { db } = await import("@/lib/db/client");
const { draftPlacement } = await import("@/lib/domain/matching");
const { publishDraftsForPeriod, removeDraftPlacement, clearDraftsForPeriod } = await import("@/lib/domain/roster-publish");
const { recomputeShiftStatus } = await import("@/lib/domain/shift-status");
const { autofillWeek } = await import("@/lib/domain/roster-autofill");
const { chefAvailability, chefs, clients, placements, shifts, users } = await import("@/lib/db/schema");
const { and, eq, inArray, ne } = await import("drizzle-orm");

const MARK = `PLANBORD_SMOKE_${crypto.randomUUID()}`;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

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

let clientId = "";
let chefId = "";

async function makeShift(startInMs: number, headcount = 1): Promise<string> {
  const [row] = await db
    .insert(shifts)
    .values({
      clientId,
      startsAt: new Date(Date.now() + startInMs),
      endsAt: new Date(Date.now() + startInMs + 4 * HOUR),
      roleNeeded: "chef_de_partie",
      headcount,
      status: "open",
      notes: MARK,
    })
    .returning({ id: shifts.id });
  return row.id;
}

const inRange = { startUtc: new Date(Date.now() - DAY), endUtc: new Date(Date.now() + 8 * DAY) };

try {
  console.log("=== planbord draft/publish smoke ===\n");

  const [cl] = await db.insert(clients).values({ companyName: `${MARK} BV` }).returning({ id: clients.id });
  clientId = cl.id;
  // email omitted → null, so publish sends NO chef mail (smoke stays side-effect-free).
  const [ch] = await db
    .insert(chefs)
    .values({ fullName: `${MARK} Chef`, status: "active" })
    .returning({ id: chefs.id });
  chefId = ch.id;
  const [actor] = await db.select({ id: users.id }).from(users).limit(1);
  const actorUserId = actor?.id ?? clientId; // any id; only used for proposedBy/audit

  // 1. draft a chef → status 'draft'
  const s1 = await makeShift(2 * HOUR, 1);
  const d1 = await draftPlacement(s1, chefId, { proposedBy: actorUserId });
  assert("draftPlacement returns 'draft'", d1.status === "draft");
  {
    const [p] = await db.select({ status: placements.status }).from(placements).where(eq(placements.id, d1.placementId)).limit(1);
    assert("placement row is 'draft'", p?.status === "draft", String(p?.status));
  }

  // 2. recompute IGNORES the draft — a concept never fills a shift
  assert("draft does not fill the shift", (await recomputeShiftStatus(s1)) === "open", "expected open");

  // 3. INVISIBLE to the chef pipeline (proposed/accepted/confirmed allowlist)
  {
    const rows = await db
      .select({ id: placements.id })
      .from(placements)
      .where(and(eq(placements.chefId, chefId), inArray(placements.status, ["proposed", "accepted", "confirmed"])));
    assert("draft invisible to chef pipeline", rows.length === 0, `${rows.length} rows`);
  }

  // 4. EXCLUDED from the ICS feed query (the fix: status != draft)
  {
    const rows = await db
      .select({ id: placements.id })
      .from(placements)
      .where(and(eq(placements.chefId, chefId), ne(placements.status, "draft")));
    assert("draft excluded from ICS feed", rows.length === 0, `${rows.length} rows`);
  }

  // 5. publish flips draft → proposed (no mail: chef email null + client has no recipients)
  {
    const res = await publishDraftsForPeriod({ ...inRange, actorUserId });
    assert("publish reports 1 published", res.published === 1, JSON.stringify(res));
    const [p] = await db.select({ status: placements.status }).from(placements).where(eq(placements.id, d1.placementId)).limit(1);
    assert("placement now 'proposed'", p?.status === "proposed", String(p?.status));
  }

  // 6. publish RE-VALIDATES: a concept overlapping the now-proposed shift is SKIPPED
  {
    const s2 = await makeShift(3 * HOUR, 1); // s1 +2..+6h, s2 +3..+7h → overlap
    const d2 = await draftPlacement(s2, chefId, { proposedBy: actorUserId });
    assert("second concept drafted", d2.status === "draft");
    const res = await publishDraftsForPeriod({ ...inRange, actorUserId });
    assert("conflicting concept skipped", res.published === 0 && res.skipped.length === 1, JSON.stringify(res));
    assert("skip reason = conflict", res.skipped[0]?.reason === "conflict", res.skipped[0]?.reason);
    const [p] = await db.select({ status: placements.status }).from(placements).where(eq(placements.id, d2.placementId)).limit(1);
    assert("conflicting concept stays 'draft'", p?.status === "draft", String(p?.status));

    // 7. removeDraft removes a draft, but can NEVER touch a published row
    assert("removeDraft removes a draft", (await removeDraftPlacement(d2.placementId)).removed === true);
    assert("removeDraft refuses a published row", (await removeDraftPlacement(d1.placementId)).removed === false);
  }

  // 8. autofill — fill far-future open slots with concepts (isolated window, so
  //    the pass can never touch real dev shifts in the current week).
  {
    const FUT = 300 * DAY;
    const sA = await makeShift(FUT, 1);
    await makeShift(FUT + 6 * HOUR, 1); // non-overlapping second shift
    const res = await autofillWeek({
      startUtc: new Date(Date.now() + FUT - DAY),
      endUtc: new Date(Date.now() + FUT + DAY),
      actorUserId,
    });
    assert("autofill fills both open slots", res.filled === 2, JSON.stringify(res));
    assert("autofill touched 2 shifts", res.shiftsTouched === 2, String(res.shiftsTouched));
    const draftsA = await db
      .select({ id: placements.id })
      .from(placements)
      .where(and(eq(placements.shiftId, sA), eq(placements.status, "draft")));
    assert("autofilled shift got a concept", draftsA.length === 1, `${draftsA.length}`);
  }

  // 9. publish RE-VALIDATES blocked: a concept for a chef blocked that day is skipped.
  {
    const FUT2 = 320 * DAY;
    const sBlk = await makeShift(FUT2, 1);
    const dBlk = await draftPlacement(sBlk, chefId, { proposedBy: actorUserId });
    const blkDay = new Date(Date.now() + FUT2);
    blkDay.setUTCHours(0, 0, 0, 0);
    await db.insert(chefAvailability).values({ chefId, date: blkDay, available: false });
    const res = await publishDraftsForPeriod({
      startUtc: new Date(Date.now() + FUT2 - DAY),
      endUtc: new Date(Date.now() + FUT2 + DAY),
      actorUserId,
    });
    assert(
      "blocked concept skipped on publish",
      res.skipped.some((s) => s.reason === "blocked"),
      JSON.stringify(res.skipped),
    );
    const [p] = await db
      .select({ status: placements.status })
      .from(placements)
      .where(eq(placements.id, dBlk.placementId))
      .limit(1);
    assert("blocked concept stays 'draft'", p?.status === "draft", String(p?.status));
  }

  // 10. clearDraftsForPeriod wipes a week's concepts (the "redo after autofill" path).
  {
    const FUT3 = 340 * DAY;
    const sC = await makeShift(FUT3, 1);
    await draftPlacement(sC, chefId, { proposedBy: actorUserId });
    const res = await clearDraftsForPeriod({
      startUtc: new Date(Date.now() + FUT3 - DAY),
      endUtc: new Date(Date.now() + FUT3 + DAY),
    });
    assert("clearDrafts removed the concept", res.removed >= 1, String(res.removed));
    const left = await db
      .select({ id: placements.id })
      .from(placements)
      .where(and(eq(placements.shiftId, sC), eq(placements.status, "draft")));
    assert("no concept remains after clear", left.length === 0, `${left.length}`);
  }

  console.log(`\n  pass: ${pass}\n  fail: ${fail}`);
} finally {
  await db.delete(placements).where(eq(placements.chefId, chefId));
  await db.delete(shifts).where(eq(shifts.notes, MARK));
  if (chefId) await db.delete(chefs).where(eq(chefs.id, chefId));
  if (clientId) await db.delete(clients).where(eq(clients.id, clientId));
}

if (fail > 0) {
  console.log("\nSmoke FAILED ✗");
  process.exit(1);
}
console.log("\nSmoke OK ✓");
process.exit(0);
