/**
 * Cockpit dashboard-intel smoke — attention ranking + delta rule (pure, no DB).
 *   npx tsx scripts/smoke-dashboard-intel.mts
 */

const di = await import("@/lib/domain/dashboard-intel");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

console.log("=== dashboard-intel smoke ===\n");

console.log("── rankAttentionItems ──");
{
  const mk = (kind: di.AttentionKind, title: string): di.AttentionItem => ({
    kind, tone: "amber", icon: "alert-triangle", title, href: "#",
  });
  // Deliberately out of priority order:
  const input = [
    mk("system", "sys"),
    mk("inbox", "inbox"),
    mk("critical_shift", "kritiek"),
    mk("hours_to_approve", "uren"),
    mk("open_shift", "open"),
    mk("missing_data", "data"),
  ];
  const ranked = di.rankAttentionItems(input).map((i) => i.kind);
  assert(
    "ranked by priority (critical → open → hours → inbox → data → system)",
    JSON.stringify(ranked) === JSON.stringify([
      "critical_shift", "open_shift", "hours_to_approve", "inbox", "missing_data", "system",
    ]),
    ranked.join(","),
  );

  // Stability: two of same kind keep insertion order.
  const stable = di.rankAttentionItems([
    mk("critical_shift", "A"), mk("critical_shift", "B"),
  ]).map((i) => i.title);
  assert("equal kind keeps insertion order", JSON.stringify(stable) === JSON.stringify(["A", "B"]));

  assert("does not mutate input", input[0].kind === "system");
}

console.log("\n── weekDelta (meaningfulness guard) ──");
{
  const up = di.weekDelta(15, 12);
  assert("baseline ≥5 → arrow up", up.mode === "arrow" && up.dir === "up", JSON.stringify(up));
  const down = di.weekDelta(8, 12);
  assert("baseline ≥5 → arrow down", down.mode === "arrow" && down.dir === "down");
  const flat = di.weekDelta(12, 12);
  assert("equal baseline ≥5 → flat", flat.mode === "arrow" && flat.dir === "flat");
  const plain = di.weekDelta(2, 3);
  assert("baseline <5 (but >0) → plain 'vorige week'", plain.mode === "plain" && plain.label.includes("vorige week"), JSON.stringify(plain));
  const hidden = di.weekDelta(2, 0);
  assert("baseline 0 → hidden (no fake ▲100%)", hidden.mode === "hidden");
  assert("1 → 2 never shows arrow", di.weekDelta(2, 1).mode !== "arrow");
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
