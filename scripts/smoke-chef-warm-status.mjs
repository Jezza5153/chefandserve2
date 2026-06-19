/**
 * Smoke — chef warm trust status (CHEF-PR0/6). Read-only, pure logic.
 *
 * Mirrors getChefWarmStatus in src/lib/chef-events.ts: derives encouraging,
 * NON-NUMERIC labels from behaviour signals. Asserts: no raw score ever leaks,
 * thresholds bucket correctly, and an empty history yields no block.
 *
 * Run: node scripts/smoke-chef-warm-status.mjs   (no DB needed — pure)
 */
let failures = 0;
const ok = (label, pass) => {
  console.log(`${pass ? "✓" : "✗"} ${label}`);
  if (!pass) failures++;
};

function warm(r) {
  const labels = [];
  if (r.avgResponseMinutes != null && r.avgResponseMinutes <= 120) labels.push("Reageert snel");
  const proposals = r.proposalsAccepted + r.proposalsRejected;
  if (proposals >= 3 && r.acceptanceRate != null && r.acceptanceRate >= 0.7) labels.push("Vaak inzetbaar");
  if (r.hoursSubmitted >= 3 && r.cancellations === 0) labels.push("Altijd komen opdagen");
  if (r.hoursSubmitted >= 1) labels.push(`${r.hoursSubmitted} ${r.hoursSubmitted === 1 ? "dienst" : "diensten"} gedraaid`);
  const headline = labels.length >= 2 ? "Je profiel is sterk" : labels.length === 1 ? "Goed bezig" : null;
  return { headline, labels };
}
const base = { totalEvents: 0, lastActivityAt: null, proposalsAccepted: 0, proposalsRejected: 0, acceptanceRate: null, cancellations: 0, hoursSubmitted: 0, avgResponseMinutes: null };

const fresh = warm(base);
ok("no history → no labels, no headline", fresh.labels.length === 0 && fresh.headline === null);

const strong = warm({ ...base, avgResponseMinutes: 30, proposalsAccepted: 8, proposalsRejected: 1, acceptanceRate: 0.89, hoursSubmitted: 10, cancellations: 0 });
ok("strong chef → headline 'Je profiel is sterk'", strong.headline === "Je profiel is sterk");
ok("strong chef → has 'Reageert snel'", strong.labels.includes("Reageert snel"));
ok("strong chef → has 'Vaak inzetbaar'", strong.labels.includes("Vaak inzetbaar"));
ok("strong chef → has 'Altijd komen opdagen'", strong.labels.includes("Altijd komen opdagen"));

const slow = warm({ ...base, avgResponseMinutes: 300, hoursSubmitted: 1 });
ok("slow responder → no 'Reageert snel'", !slow.labels.includes("Reageert snel"));
ok("1 dienst → '1 dienst gedraaid' (singular)", slow.labels.includes("1 dienst gedraaid"));

const cancelled = warm({ ...base, hoursSubmitted: 5, cancellations: 2 });
ok("has cancellations → no 'Altijd komen opdagen'", !cancelled.labels.includes("Altijd komen opdagen"));

const lowAccept = warm({ ...base, proposalsAccepted: 1, proposalsRejected: 5, acceptanceRate: 0.17, hoursSubmitted: 0 });
ok("low acceptance → no 'Vaak inzetbaar'", !lowAccept.labels.includes("Vaak inzetbaar"));

// AVG: never emit a numeric score / percentage
const allText = JSON.stringify([fresh, strong, slow, cancelled, lowAccept]);
ok("no percentage/score string leaks", !/%|reliability|score|\b\d\d\b\s*\/\s*\d/i.test(allText));

console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
