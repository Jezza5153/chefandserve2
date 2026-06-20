/**
 * smoke-shift-ops-status — pure checks for the owner operational-status vocabulary.
 * No DB/LLM. The module has no server imports → plain dynamic import runs clean.
 */
const { shiftOpsStatus } = await import("../src/lib/shift-ops-status.ts");

let pass = 0;
const fail: string[] = [];
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else fail.push(name);
}

const NOW = 1_700_000_000_000;
const future = new Date(NOW + 6 * 3_600_000); // starts in 6h
const past = new Date(NOW - 1 * 3_600_000); // started 1h ago
const base = { headcount: 1, confirmed: 0, accepted: 0, proposedPending: 0, startsAt: future, now: NOW };

// terminal shift statuses win regardless of placements
ok("cancelled", shiftOpsStatus({ ...base, shiftStatus: "cancelled", confirmed: 1 }).key === "cancelled");
ok("completed → done", shiftOpsStatus({ ...base, shiftStatus: "completed", confirmed: 1 }).key === "done");
ok("request → requested", shiftOpsStatus({ ...base, shiftStatus: "request" }).key === "requested");

// open lifecycle, upcoming shift
ok("open: no placements", shiftOpsStatus({ ...base, shiftStatus: "open" }).key === "open");
ok("open: proposed pending → awaiting_reply", shiftOpsStatus({ ...base, shiftStatus: "open", proposedPending: 2 }).key === "awaiting_reply");
ok("open: accepted → chef_found", shiftOpsStatus({ ...base, shiftStatus: "open", accepted: 1, proposedPending: 1 }).key === "chef_found");
ok("open: accepted beats pending", shiftOpsStatus({ ...base, shiftStatus: "open", accepted: 1, proposedPending: 3 }).key === "chef_found");

// partial vs full staffing (headcount 2)
ok(
  "partly_staffed (1/2 confirmed)",
  shiftOpsStatus({ ...base, shiftStatus: "open", headcount: 2, confirmed: 1, accepted: 1 }).key === "partly_staffed",
);
ok("partly_staffed nextStep shows open slots", shiftOpsStatus({ ...base, shiftStatus: "open", headcount: 3, confirmed: 1 }).nextStep.includes("2 plek"));
ok("staffed (2/2 confirmed, upcoming)", shiftOpsStatus({ ...base, shiftStatus: "open", headcount: 2, confirmed: 2 }).key === "staffed");
ok("filled status + full confirmed → staffed", shiftOpsStatus({ ...base, shiftStatus: "filled", confirmed: 1 }).key === "staffed");

// started shift → running
ok("started + full confirmed → running", shiftOpsStatus({ ...base, shiftStatus: "filled", confirmed: 1, startsAt: past }).key === "running");
ok(
  "started + partial confirmed → running (warn)",
  (() => {
    const r = shiftOpsStatus({ ...base, shiftStatus: "open", headcount: 2, confirmed: 1, startsAt: past });
    return r.key === "running" && r.tone === "warn";
  })(),
);
ok(
  "NOT started + partial → partly_staffed (not running)",
  shiftOpsStatus({ ...base, shiftStatus: "open", headcount: 2, confirmed: 1, startsAt: future }).key === "partly_staffed",
);

// confirmed beats accepted/pending; headcount<=0 guarded to 1
ok("confirmed beats accepted", shiftOpsStatus({ ...base, shiftStatus: "open", confirmed: 1, accepted: 5 }).key === "staffed");
ok("headcount 0 guarded → 1 (confirmed 1 = staffed)", shiftOpsStatus({ ...base, shiftStatus: "open", headcount: 0, confirmed: 1 }).key === "staffed");

// every result carries a non-empty label + nextStep + a valid tone
{
  const tones = new Set(["neutral", "progress", "good", "warn", "muted"]);
  const cases = [
    shiftOpsStatus({ ...base, shiftStatus: "open" }),
    shiftOpsStatus({ ...base, shiftStatus: "open", proposedPending: 1 }),
    shiftOpsStatus({ ...base, shiftStatus: "filled", confirmed: 1 }),
    shiftOpsStatus({ ...base, shiftStatus: "completed" }),
  ];
  ok("all have label+nextStep+tone", cases.every((c) => c.label && c.nextStep && tones.has(c.tone)));
}

if (fail.length) {
  console.error(`smoke-shift-ops-status FAILED (${fail.length}): ${fail.join(", ")}`);
  process.exit(1);
}
console.log(`smoke-shift-ops-status OK — ${pass} checks passed`);
