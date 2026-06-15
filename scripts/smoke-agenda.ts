/**
 * Owner agenda read-model — pure mapping checks (shift→event, change-request→event).
 * Imports the module (pulls in env), so run with an env file:
 *   npx tsx --env-file=.env.local scripts/smoke-agenda.ts
 */
import { shiftToAgendaEvent, changeRequestToAgendaEvent } from "@/lib/domain/agenda";

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

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
