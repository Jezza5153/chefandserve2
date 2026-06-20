/**
 * smoke-proposal-wait — pure unit checks for the P4d no-response timer read-model.
 * No DB, no LLM. Dynamic import dodges the tsx .mts named-export trap.
 */
const { summarizePendingProposals, noResponseThresholdMin } = await import(
  "../src/lib/domain/proposal-wait.ts"
);

let pass = 0;
const fail: string[] = [];
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else fail.push(name);
}

const NOW = 1_700_000_000_000; // fixed epoch ms
const minsAgo = (m: number) => new Date(NOW - m * 60_000);

// 1. empty input → nothing pending, no nudge
{
  const s = summarizePendingProposals([], { now: NOW, thresholdMin: 20 });
  ok("empty: no proposals", s.proposals.length === 0);
  ok("empty: no stale", s.staleCount === 0);
  ok("empty: no nudge", s.nudge === null);
}

// 2. fresh proposal under threshold → not stale, no nudge
{
  const s = summarizePendingProposals(
    [{ chefId: "c1", chefName: "Sam", proposedAt: minsAgo(5), seenAt: null }],
    { now: NOW, thresholdMin: 20 },
  );
  ok("fresh: 5 min wait", s.proposals[0].waitMinutes === 5);
  ok("fresh: label", s.proposals[0].waitLabel === "5 min");
  ok("fresh: not stale", s.proposals[0].stale === false);
  ok("fresh: not seen", s.proposals[0].seen === false);
  ok("fresh: no nudge", s.nudge === null);
}

// 3. stale proposal past threshold → stale + nudge, seen flag honoured
{
  const s = summarizePendingProposals(
    [{ chefId: "c1", chefName: "Sam", proposedAt: minsAgo(35), seenAt: minsAgo(30) }],
    { now: NOW, thresholdMin: 20 },
  );
  ok("stale: is stale", s.proposals[0].stale === true);
  ok("stale: seen", s.proposals[0].seen === true);
  ok("stale: staleCount", s.staleCount === 1);
  ok("stale: nudge present", typeof s.nudge === "string" && s.nudge!.includes("Sam"));
  ok("stale: nudge mentions seen", s.nudge!.includes("gezien"));
}

// 4. sort oldest-first; nudge cites the oldest
{
  const s = summarizePendingProposals(
    [
      { chefId: "young", chefName: "Jong", proposedAt: minsAgo(8), seenAt: null },
      { chefId: "old", chefName: "Oud", proposedAt: minsAgo(90), seenAt: null },
    ],
    { now: NOW, thresholdMin: 20 },
  );
  ok("sort: oldest first", s.proposals[0].chefId === "old");
  ok("sort: nudge cites oldest", s.nudge!.includes("Oud") && !s.nudge!.includes("Jong"));
  ok("sort: only old is stale", s.staleCount === 1);
}

// 5. wait label formatting (min / hours / hours+min / net)
{
  const s = summarizePendingProposals(
    [
      { chefId: "a", chefName: "A", proposedAt: minsAgo(0), seenAt: null },
      { chefId: "b", chefName: "B", proposedAt: minsAgo(60), seenAt: null },
      { chefId: "c", chefName: "C", proposedAt: minsAgo(130), seenAt: null },
    ],
    { now: NOW, thresholdMin: 999 },
  );
  const byId = Object.fromEntries(s.proposals.map((p) => [p.chefId, p.waitLabel]));
  ok("label: net", byId.a === "net");
  ok("label: 1 u", byId.b === "1 u");
  ok("label: 2 u 10 min", byId.c === "2 u 10 min");
}

// 6. null chefName → fallback label
{
  const s = summarizePendingProposals(
    [{ chefId: "x", chefName: null, proposedAt: minsAgo(2), seenAt: null }],
    { now: NOW, thresholdMin: 20 },
  );
  ok("null name: fallback", s.proposals[0].chefName === "Onbekende chef");
}

// 7. urgency-scaled threshold
{
  ok("threshold: <=4h → 10", noResponseThresholdMin(2) === 10);
  ok("threshold: <=12h → 20", noResponseThresholdMin(8) === 20);
  ok("threshold: <=48h → 45", noResponseThresholdMin(24) === 45);
  ok("threshold: far out → 120", noResponseThresholdMin(72) === 120);
  ok("threshold: boundary 4 → 10", noResponseThresholdMin(4) === 10);
  ok("threshold: boundary 12 → 20", noResponseThresholdMin(12) === 20);
}

// 8. future proposedAt (clock skew) clamps to 0, never negative
{
  const s = summarizePendingProposals(
    [{ chefId: "f", chefName: "Future", proposedAt: new Date(NOW + 60_000), seenAt: null }],
    { now: NOW, thresholdMin: 20 },
  );
  ok("skew: clamped to 0", s.proposals[0].waitMinutes === 0);
  ok("skew: not stale", s.proposals[0].stale === false);
}

if (fail.length) {
  console.error(`smoke-proposal-wait FAILED (${fail.length}): ${fail.join(", ")}`);
  process.exit(1);
}
console.log(`smoke-proposal-wait OK — ${pass} checks passed`);
