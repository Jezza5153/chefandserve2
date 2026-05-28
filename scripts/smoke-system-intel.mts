/**
 * Cockpit system-intel smoke — system attention ranking + health rollup (pure, no DB).
 *   npx tsx scripts/smoke-system-intel.mts
 */

const si = await import("@/lib/domain/system-intel");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

console.log("=== system-intel smoke ===\n");

const mk = (kind: si.SystemAttentionKind): si.SystemAttentionItem => ({
  kind, tone: "amber", icon: "alert-triangle", title: kind, href: "#",
});

console.log("── rankSystemItems ──");
{
  // Deliberately scrambled:
  const input = [
    mk("privacy_due_soon"),
    mk("webhook_failure"),
    mk("failed_outbox"),
    mk("critical_error"),
    mk("backup_failed"),
    mk("health_failing"),
    mk("privacy_overdue"),
    mk("email_bounce_spike"),
  ];
  const order = si.rankSystemItems(input).map((i) => i.kind);
  assert(
    "full priority order",
    JSON.stringify(order) === JSON.stringify([
      "critical_error", "failed_outbox", "privacy_overdue", "backup_failed",
      "health_failing", "email_bounce_spike", "webhook_failure", "privacy_due_soon",
    ]),
    order.join(","),
  );

  const two = si.rankSystemItems([mk("failed_outbox"), mk("critical_error")]).map((i) => i.kind);
  assert("critical errors rank above failed outbox", two[0] === "critical_error");

  const pv = si.rankSystemItems([mk("privacy_due_soon"), mk("privacy_overdue")]).map((i) => i.kind);
  assert("privacy overdue above privacy due-soon", pv[0] === "privacy_overdue");

  const ranked = si.rankSystemItems(input).map((i) => i.kind);
  assert("stale/failed backup surfaces", ranked.includes("backup_failed"));
  assert("health failure surfaces", ranked.includes("health_failing"));
  const KNOWN = [
    "critical_error", "failed_outbox", "privacy_overdue", "backup_failed",
    "health_failing", "email_bounce_spike", "webhook_failure", "privacy_due_soon",
  ];
  assert("AI/usage is never a system attention kind", ranked.every((k) => KNOWN.includes(k)));

  assert("empty input → calm empty queue", si.rankSystemItems([]).length === 0);
  assert("does not mutate input", input[0].kind === "privacy_due_soon");
}

console.log("\n── systemHealthRollup ──");
{
  const base = { criticalErrors: 0, healthDown: false, backupFailedOrStale: false, outboxFailed: 0, webhookFailures: 0, privacyOverdue: 0 };
  assert("all clear → operationeel", si.systemHealthRollup(base) === "operationeel");
  assert("critical error → kritiek", si.systemHealthRollup({ ...base, criticalErrors: 1 }) === "kritiek");
  assert("health down → kritiek", si.systemHealthRollup({ ...base, healthDown: true }) === "kritiek");
  assert("backup failed/stale → kritiek", si.systemHealthRollup({ ...base, backupFailedOrStale: true }) === "kritiek");
  assert("failed outbox only → aandacht", si.systemHealthRollup({ ...base, outboxFailed: 2 }) === "aandacht");
  assert("webhook failure only → aandacht", si.systemHealthRollup({ ...base, webhookFailures: 1 }) === "aandacht");
  assert("privacy overdue only → aandacht", si.systemHealthRollup({ ...base, privacyOverdue: 1 }) === "aandacht");
  assert("critical outranks aandacht signals", si.systemHealthRollup({ ...base, criticalErrors: 1, outboxFailed: 5 }) === "kritiek");
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
