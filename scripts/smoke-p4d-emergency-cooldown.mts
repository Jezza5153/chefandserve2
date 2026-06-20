/**
 * smoke-p4d-emergency-cooldown — pure checks for filterReopenSuppressed (P4d review fix):
 * a resolved/stood-down escalation must NOT re-open on the next detection scan. No DB/LLM.
 * Dynamic import dodges the tsx .mts named-export trap.
 */
const { filterReopenSuppressed } = await import("../src/lib/domain/emergencies.ts");

let pass = 0;
const fail: string[] = [];
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else fail.push(name);
}

const NOW = 1_700_000_000_000;
const now = new Date(NOW);
const hAgo = (h: number) => new Date(NOW - h * 3_600_000);

// builders
const cond = (shiftId: string, kind: string) => ({ shiftId, placementId: null, kind, reason: "x", severity: "amber" as const });
const evt = (shiftId: string, kind: string, triggerAt: Date) => ({ shiftId, placementId: "p", kind, reason: "x", severity: "red" as const, triggerAt });
const closed = (shiftId: string, kind: string, resolvedAt: Date | null) => ({ shiftId, kind, resolvedAt });
const keys = (arr: { shiftId: string; kind: string }[]) => new Set(arr.map((c) => c.shiftId + ":" + c.kind));

// 1. no closes → everything kept
{
  const c = [cond("s1", "unassigned_soon"), evt("s2", "chef_cancelled_late", hAgo(1))];
  ok("no close → all kept", filterReopenSuppressed(c as any, [], now).length === 2);
}

// 2. condition-based, closed within cooldown → suppressed
{
  const c = [cond("s1", "unassigned_soon")];
  const out = filterReopenSuppressed(c as any, [closed("s1", "unassigned_soon", hAgo(1))], now);
  ok("cond: close 1h ago → suppressed (cooldown 12h)", out.length === 0);
}

// 3. condition-based, closed AFTER cooldown elapsed → kept
{
  const c = [cond("s1", "unassigned_soon")];
  const out = filterReopenSuppressed(c as any, [closed("s1", "unassigned_soon", hAgo(13))], now);
  ok("cond: close 13h ago → kept (cooldown 12h elapsed)", out.length === 1);
}

// 4. unconfirmed_near_start has its own 4h cooldown
{
  ok(
    "cond unconfirmed: 3h → suppressed",
    filterReopenSuppressed([cond("s1", "unconfirmed_near_start")] as any, [closed("s1", "unconfirmed_near_start", hAgo(3))], now).length === 0,
  );
  ok(
    "cond unconfirmed: 5h → kept",
    filterReopenSuppressed([cond("s1", "unconfirmed_near_start")] as any, [closed("s1", "unconfirmed_near_start", hAgo(5))], now).length === 1,
  );
}

// 5. event-based: trigger BEFORE the close → already handled → suppressed
{
  const c = [evt("s1", "chef_cancelled_late", hAgo(3))];
  const out = filterReopenSuppressed(c as any, [closed("s1", "chef_cancelled_late", hAgo(2))], now);
  ok("evt: trigger before close → suppressed", out.length === 0);
}

// 6. event-based: a NEW trigger AFTER the close → re-open
{
  const c = [evt("s1", "chef_cancelled_late", hAgo(1))];
  const out = filterReopenSuppressed(c as any, [closed("s1", "chef_cancelled_late", hAgo(2))], now);
  ok("evt: new trigger after close → kept", out.length === 1);
}

// 7. chef_signal: new urgent signal after close re-opens; stale one stays suppressed
{
  ok(
    "signal: new after close → kept",
    filterReopenSuppressed([evt("s1", "chef_signal", hAgo(0.5))] as any, [closed("s1", "chef_signal", hAgo(1))], now).length === 1,
  );
  ok(
    "signal: stale (before close) → suppressed",
    filterReopenSuppressed([evt("s1", "chef_signal", hAgo(2))] as any, [closed("s1", "chef_signal", hAgo(1))], now).length === 0,
  );
}

// 8. uses the LATEST close per (shift,kind), not the oldest
{
  const c = [cond("s1", "unassigned_soon")];
  const out = filterReopenSuppressed(c as any, [closed("s1", "unassigned_soon", hAgo(20)), closed("s1", "unassigned_soon", hAgo(2))], now);
  ok("cond: latest close wins → suppressed", out.length === 0);
}

// 9. null resolvedAt is ignored (no close)
{
  const c = [cond("s1", "unassigned_soon")];
  ok("null resolvedAt → ignored, kept", filterReopenSuppressed(c as any, [closed("s1", "unassigned_soon", null)], now).length === 1);
}

// 10. a close on a DIFFERENT kind / shift never suppresses
{
  const c = [cond("s1", "unconfirmed_near_start")];
  ok("different kind → kept", filterReopenSuppressed(c as any, [closed("s1", "unassigned_soon", hAgo(1))], now).length === 1);
  ok("different shift → kept", filterReopenSuppressed(c as any, [closed("s2", "unconfirmed_near_start", hAgo(1))], now).length === 1);
}

// 11. mixed batch keeps exactly the right survivors
{
  const c = [
    cond("a", "unassigned_soon"), // close 1h → suppressed
    cond("b", "unassigned_soon"), // close 13h → kept
    evt("c", "chef_cancelled_late", hAgo(1)), // trigger after close → kept
    evt("d", "chef_signal", hAgo(2)), // trigger before close → suppressed
  ];
  const cl = [
    closed("a", "unassigned_soon", hAgo(1)),
    closed("b", "unassigned_soon", hAgo(13)),
    closed("c", "chef_cancelled_late", hAgo(2)),
    closed("d", "chef_signal", hAgo(1)),
  ];
  const survivors = keys(filterReopenSuppressed(c as any, cl, now) as any);
  ok("mixed: b kept", survivors.has("b:unassigned_soon"));
  ok("mixed: c kept", survivors.has("c:chef_cancelled_late"));
  ok("mixed: a suppressed", !survivors.has("a:unassigned_soon"));
  ok("mixed: d suppressed", !survivors.has("d:chef_signal"));
  ok("mixed: exactly 2 survive", survivors.size === 2);
}

if (fail.length) {
  console.error(`smoke-p4d-emergency-cooldown FAILED (${fail.length}): ${fail.join(", ")}`);
  process.exit(1);
}
console.log(`smoke-p4d-emergency-cooldown OK — ${pass} checks passed`);
