/**
 * Owner agenda read-model — pure mapping checks (shift→event, change-request→event,
 * manual→event) + a live round-trip of the manual-event CRUD on the dev DB. Imports
 * the module (pulls in env), so run with an env file:
 *   npx tsx --env-file=.env.local scripts/smoke-agenda.ts
 */
import { eq } from "drizzle-orm";

import {
  shiftToAgendaEvent,
  changeRequestToAgendaEvent,
  manualEventToAgendaEvent,
  getAgendaEvents,
} from "@/lib/domain/agenda";
import {
  createAgendaEvent,
  setAgendaEventStatus,
  toggleChecklistItem,
  parseChecklist,
  agendaEventLabel,
} from "@/lib/domain/agenda-events";
import { db } from "@/lib/db/client";
import { agendaEvents, users } from "@/lib/db/schema";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

const baseShift = {
  id: "s1",
  startsAt: new Date("2026-06-20T06:00:00Z"),
  endsAt: new Date("2026-06-20T14:00:00Z"),
  roleNeeded: "sous_chef",
  headcount: 2,
  status: "open",
  city: "Amsterdam",
  clientId: "c1",
  companyName: "Hotel X",
};

console.log("=== Owner agenda read-model (pure mappers) ===\n");

// Open shift (filled 1 of 2) → open_shift, fill-drawer href, warn.
const openEv = shiftToAgendaEvent(baseShift, 1);
assert("open shift → type open_shift", openEv.type === "open_shift");
assert("open shift → fill-drawer href", openEv.href === "/admin/business?drawer=open-shift&shiftId=s1");
assert("open shift → warn tone", openEv.tone === "warn");
assert("open shift → subtitle shows fill", openEv.subtitle.includes("1/2 bemand"));
assert("open shift → dayKey set", /^\d{4}-\d{2}-\d{2}$/.test(openEv.dayKey));

// Fully filled (2 of 2) → shift, detail href, neutral.
const fullEv = shiftToAgendaEvent(baseShift, 2);
assert("full shift → type shift", fullEv.type === "shift");
assert("full shift → detail href", fullEv.href === "/admin/business/shifts/s1");
assert("full shift → neutral tone", fullEv.tone === "neutral");

// Overfill clamps (3 reported, headcount 2) → still full, not negative open.
const overEv = shiftToAgendaEvent(baseShift, 3);
assert("overfill clamps → type shift", overEv.type === "shift");

// Cancelled → never 'open', subtitle says Geannuleerd.
const cancelEv = shiftToAgendaEvent({ ...baseShift, status: "cancelled" }, 0);
assert("cancelled → type shift (not open)", cancelEv.type === "shift");
assert("cancelled → subtitle Geannuleerd", cancelEv.subtitle === "Geannuleerd");

// Change request → follow-up.
const cr = changeRequestToAgendaEvent({
  id: "r1", kind: "cancel", shiftId: "s1", clientId: "c1", companyName: "Hotel X",
  shiftStartsAt: new Date("2026-06-20T06:00:00Z"),
});
assert("change-request → type change_request", cr.type === "change_request");
assert("change-request → cancel label", cr.title.includes("Annuleringsverzoek"));
assert("change-request → warn tone", cr.tone === "warn");
assert("change-request → links to the shift", cr.href === "/admin/business/shifts/s1");

// ---- manual-event pure mapper ----
const NOW = new Date("2026-06-15T12:00:00Z");
const futureManual = manualEventToAgendaEvent(
  {
    id: "m1", type: "intake_call", startsAt: new Date("2026-06-20T09:00:00Z"), endsAt: null,
    title: "Intake Hotel X", notes: "Menu doornemen", status: "open",
    checklist: [{ label: "Contract", done: true }, { label: "Allergieën", done: false }],
    clientId: "c1", clientName: "Hotel X", chefName: null, assignedToName: "Maarten",
  },
  NOW,
);
assert("manual → type manual", futureManual.type === "manual");
assert("manual → no href (rendered inline)", futureManual.href === "");
assert("manual → neutral tone when future+open", futureManual.tone === "neutral");
assert("manual → carries manual meta", futureManual.manual?.eventId === "m1");
assert("manual → kindLabel Intakegesprek", futureManual.manual?.kindLabel === "Intakegesprek");
assert("manual → subtitle shows checklist progress", futureManual.subtitle.includes("1/2 afgevinkt"));

const overdueManual = manualEventToAgendaEvent(
  { id: "m2", type: "follow_up", startsAt: new Date("2026-06-10T09:00:00Z"), endsAt: null, title: "Bel terug",
    notes: null, status: "open", checklist: null, clientId: null, clientName: null, chefName: null, assignedToName: null },
  NOW,
);
assert("manual → warn tone when overdue+open", overdueManual.tone === "warn");
assert("manual → 'over tijd' in subtitle when overdue", overdueManual.subtitle.includes("over tijd"));

const doneManual = manualEventToAgendaEvent(
  { id: "m3", type: "contract_start", startsAt: new Date("2026-06-10T09:00:00Z"), endsAt: null, title: "Start",
    notes: null, status: "done", checklist: null, clientId: null, clientName: null, chefName: null, assignedToName: null },
  NOW,
);
assert("manual → good tone when done", doneManual.tone === "good");
assert("manual → status done in meta", doneManual.manual?.status === "done");

// ---- parseChecklist ----
assert("parseChecklist null on empty", parseChecklist("") === null);
const cl = parseChecklist("Contract\n  Menu  \n\nAllergieën");
assert("parseChecklist trims + drops blanks", cl?.length === 3);
assert("parseChecklist items default undone", cl?.every((i) => i.done === false) === true);
assert("agendaEventLabel maps known kind", agendaEventLabel("onboarding_task") === "Onboarding-taak");
assert("agendaEventLabel passthrough unknown", agendaEventLabel("weird") === "weird");

// ---- live DB round-trip (create → read → toggle → complete → cancel → cleanup) ----
async function liveRoundTrip() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) { console.log("  (skip live round-trip — no users on this DB)"); return; }

  const startsAt = new Date(Date.now() + 24 * 3_600_000);
  const from = new Date(Date.now() - 3_600_000);
  const to = new Date(Date.now() + 3 * 864e5);
  let createdId = "";
  try {
    const row = await createAgendaEvent({
      type: "intake_call",
      title: "__SMOKE intake__",
      startsAt,
      checklist: [{ label: "stap 1", done: false }, { label: "stap 2", done: false }],
      createdBy: u.id,
    });
    createdId = row.id;
    assert("create → returns row with id", Boolean(row.id));
    assert("create → assignedTo defaults to creator", row.assignedTo === u.id);
    assert("create → status open", row.status === "open");

    const inWindow = await getAgendaEvents({ from, to });
    const found = inWindow.find((e) => e.manual?.eventId === createdId);
    assert("read → manual event appears in window", Boolean(found));
    assert("read → type manual", found?.type === "manual");

    const toggled = await toggleChecklistItem(createdId, 0);
    assert("toggle → returns true", toggled === true);
    const afterToggle = (await getAgendaEvents({ from, to })).find((e) => e.manual?.eventId === createdId);
    assert("toggle → item 0 now done", afterToggle?.manual?.checklist?.[0].done === true);
    assert("toggle → item 1 still undone", afterToggle?.manual?.checklist?.[1].done === false);
    const badToggle = await toggleChecklistItem(createdId, 99);
    assert("toggle → out-of-range returns false", badToggle === false);

    const done = await setAgendaEventStatus(createdId, "done");
    assert("complete → returns row", Boolean(done));
    const doneAgain = await setAgendaEventStatus(createdId, "done");
    assert("complete → re-complete is a no-op (null)", doneAgain === null);

    const cancelled = await setAgendaEventStatus(createdId, "cancelled");
    assert("cancel → returns row", Boolean(cancelled));
    const afterCancel = (await getAgendaEvents({ from, to })).find((e) => e.manual?.eventId === createdId);
    assert("cancel → drops out of the agenda window", afterCancel === undefined);
  } finally {
    if (createdId) await db.delete(agendaEvents).where(eq(agendaEvents.id, createdId));
  }
}

liveRoundTrip()
  .then(() => {
    console.log(`\n=== ${pass} passed, ${fail} failed ===`);
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
