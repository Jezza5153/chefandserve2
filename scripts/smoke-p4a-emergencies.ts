/**
 * P4a emergencies — pure classifier boundaries + a live escalation CRUD round-trip
 * (idempotent open via the partial unique + atomic resolve/stand-down). Imports the db
 * client → .ts (not .mts) + run with an env file:
 *   npx tsx --env-file=.env.local scripts/smoke-p4a-emergencies.ts
 * The pure block runs with no DB; the round-trip creates + cleans up throwaway fixtures.
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, escalations, shifts, users } from "@/lib/db/schema";
import {
  classifyCancelledLate,
  classifyChefSignal,
  classifyUnassignedSoon,
  classifyUnconfirmedNearStart,
  isUrgentSignalKind,
  openEscalation,
  resolveEscalation,
  standDown,
} from "@/lib/domain/emergencies";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

const NOW = new Date("2026-06-20T12:00:00Z");
const inH = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const agoH = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

console.log("=== P4a emergencies — pure classifiers ===\n");

// chef_cancelled_late
const cancelledP = { id: "p1", status: "cancelled", confirmedAt: agoH(2), cancelledAt: agoH(1) };
assert("cancelled-late fires at 23h to start", !!classifyCancelledLate(cancelledP, { id: "s1", startsAt: inH(23), status: "open" }, NOW));
assert("cancelled-late silent at 25h to start", classifyCancelledLate(cancelledP, { id: "s1", startsAt: inH(25), status: "open" }, NOW) === null);
assert("cancelled-late silent if chef was never confirmed", classifyCancelledLate({ ...cancelledP, confirmedAt: null }, { id: "s1", startsAt: inH(23), status: "open" }, NOW) === null);
assert("cancelled-late silent on terminal shift", classifyCancelledLate(cancelledP, { id: "s1", startsAt: inH(23), status: "cancelled" }, NOW) === null);
assert("cancelled-late severity red", classifyCancelledLate(cancelledP, { id: "s1", startsAt: inH(23), status: "open" }, NOW)?.severity === "red");

// unassigned_soon
assert("unassigned fires when 1/2 filled within 12h", classifyUnassignedSoon({ id: "s2", startsAt: inH(8), status: "open", headcount: 2, filled: 1 }, NOW)?.kind === "unassigned_soon");
assert("unassigned silent when full", classifyUnassignedSoon({ id: "s2", startsAt: inH(8), status: "open", headcount: 2, filled: 2 }, NOW) === null);
assert("unassigned silent beyond 12h", classifyUnassignedSoon({ id: "s2", startsAt: inH(13), status: "open", headcount: 2, filled: 0 }, NOW) === null);
assert("unassigned red when 0 filled, amber when partial", classifyUnassignedSoon({ id: "s2", startsAt: inH(8), status: "open", headcount: 2, filled: 0 }, NOW)?.severity === "red" && classifyUnassignedSoon({ id: "s2", startsAt: inH(8), status: "open", headcount: 2, filled: 1 }, NOW)?.severity === "amber");

// unconfirmed_near_start
const acceptedP = { id: "p3", status: "accepted", confirmedAt: null as Date | null };
assert("unconfirmed fires at 3h, accepted+unconfirmed", classifyUnconfirmedNearStart(acceptedP, { id: "s3", startsAt: inH(3), status: "open" }, NOW)?.kind === "unconfirmed_near_start");
assert("unconfirmed silent once confirmed", classifyUnconfirmedNearStart({ ...acceptedP, confirmedAt: agoH(1) }, { id: "s3", startsAt: inH(3), status: "open" }, NOW) === null);
assert("unconfirmed silent beyond 4h", classifyUnconfirmedNearStart(acceptedP, { id: "s3", startsAt: inH(5), status: "open" }, NOW) === null);

// chef_signal
assert("isUrgentSignalKind: hulp/onveilig/vertraagd yes, onderweg no", isUrgentSignalKind("hulp") && isUrgentSignalKind("onveilig") && isUrgentSignalKind("vertraagd") && !isUrgentSignalKind("onderweg"));
assert("chef_signal fires for hulp within 6h (red)", classifyChefSignal({ placementId: "p4", shiftId: "s4", kind: "hulp", createdAt: agoH(1) }, { status: "open" }, NOW)?.severity === "red");
assert("chef_signal amber for vertraagd", classifyChefSignal({ placementId: "p4", shiftId: "s4", kind: "vertraagd", createdAt: agoH(1) }, { status: "open" }, NOW)?.severity === "amber");
assert("chef_signal silent for non-urgent kind", classifyChefSignal({ placementId: "p4", shiftId: "s4", kind: "onderweg", createdAt: agoH(1) }, { status: "open" }, NOW) === null);
assert("chef_signal silent beyond 6h", classifyChefSignal({ placementId: "p4", shiftId: "s4", kind: "hulp", createdAt: agoH(7) }, { status: "open" }, NOW) === null);
assert("chef_signal never copies chef free text (reason is machine-built)", classifyChefSignal({ placementId: "p4", shiftId: "s4", kind: "onveilig", createdAt: agoH(1) }, { status: "open" }, NOW)?.reason === "Chef voelt zich niet veilig — urgent signaal tijdens de dienst.");

// ---- live escalation CRUD round-trip ----
async function dbRoundTrip() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  const resolver = u?.id ?? "";
  let clientId = "";
  let shiftId = "";
  try {
    [{ id: clientId }] = await db.insert(clients).values({ companyName: "__SMOKE_P4A__", email: null }).returning({ id: clients.id });
    const start = inH(8);
    [{ id: shiftId }] = await db.insert(shifts).values({ clientId, roleNeeded: "sous_chef", startsAt: start, endsAt: new Date(start.getTime() + 8 * 3_600_000) }).returning({ id: shifts.id });

    // idempotent open: first creates, second collapses on the partial unique.
    const o1 = await openEscalation({ shiftId, kind: "unassigned_soon", reason: "smoke" });
    assert("openEscalation → created:true first time", o1.ok && o1.created === true);
    const o2 = await openEscalation({ shiftId, kind: "unassigned_soon", reason: "smoke" });
    assert("openEscalation → created:false, same id (partial-unique collapse, no 42P10)", o1.ok && o2.ok && o2.created === false && o2.id === o1.id);

    const escId = o1.ok ? o1.id : "";
    // atomic resolve: first ok, second rejected (already closed).
    const r1 = await resolveEscalation({ escalationId: escId, resolvedBy: resolver, resolutionNotes: "opgelost in smoke" });
    assert("resolveEscalation → ok", r1.ok === true);
    const r2 = await resolveEscalation({ escalationId: escId, resolvedBy: resolver });
    assert("resolveEscalation again → wrong_status (atomic 0-row)", r2.ok === false && r2.error === "wrong_status");

    // a fresh open + standDown.
    const o3 = await openEscalation({ shiftId, kind: "unconfirmed_near_start", reason: "smoke2" });
    const s1 = await standDown({ escalationId: o3.ok ? o3.id : "", resolvedBy: resolver });
    assert("standDown → ok on a fresh open row", s1.ok === true);
  } finally {
    if (shiftId) await db.delete(escalations).where(eq(escalations.shiftId, shiftId)).catch(() => {});
    if (shiftId) await db.delete(shifts).where(eq(shifts.id, shiftId)).catch(() => {});
    if (clientId) await db.delete(clients).where(eq(clients.id, clientId)).catch(() => {});
  }
}

dbRoundTrip()
  .then(() => {
    console.log(`\n=== ${pass} passed, ${fail} failed ===`);
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch((e) => { console.error(e); process.exit(1); });
