/**
 * Dashboard card contract well-formedness — every attention kind maps losslessly to a
 * DashboardCard that satisfies the "no dead cards" rule (a signal, a drawer, ≥1 action,
 * a valid card type, and a priority that matches the ranking). Pure; no DB, no env.
 *   npx tsx scripts/smoke-dashboard-cards.mts
 */
const { toCard } = await import("@/lib/domain/dashboard-cards");
const { rankAttentionItems, priorityOf } = await import("@/lib/domain/dashboard-intel");
import type { AttentionItem, AttentionKind } from "@/lib/domain/dashboard-intel";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

const VALID_CARD_TYPES = new Set(["fire", "risk", "money", "task", "opportunity"]);
const VALID_DRAWERS = new Set(["shift", "open-shift", "hours", "queue", "timeline", "fill"]);
const VALID_VIA = new Set(["form", "ai", "link"]);
const VALID_SAFETY = new Set(["one_click", "review_required", "link_only"]);

// All 10 attention kinds (the 9 live + system). Synthetic but shaped like the page builds them.
const KINDS: AttentionKind[] = [
  "critical_shift", "open_shift", "underfilled_shift", "accepted_unconfirmed",
  "proposed_no_response", "hours_to_approve", "change_request", "inbox", "missing_data", "system",
];

function sample(kind: AttentionKind): AttentionItem {
  return {
    kind,
    tone: "amber",
    icon: "alert-triangle",
    title: `signal voor ${kind}`,
    detail: "waarom dit nu telt",
    href: `/admin/business/x/${kind}`,
    cta: "Bekijk",
  };
}

console.log("=== Dashboard card contract ===\n");

for (const kind of KINDS) {
  const c = toCard(sample(kind));
  assert(`${kind}: signal non-empty`, c.signal.length > 0);
  assert(`${kind}: nextAction non-empty`, c.nextAction.length > 0);
  assert(`${kind}: valid cardType`, VALID_CARD_TYPES.has(c.cardType), c.cardType);
  assert(`${kind}: priority matches dashboard-intel`, c.priority === priorityOf(kind), `${c.priority}`);
  assert(`${kind}: valid drawer route`, VALID_DRAWERS.has(c.drawer.route), c.drawer.route);
  assert(`${kind}: auditKey shaped`, c.auditKey === `dashboard.card.${kind}`, c.auditKey);
  // No-dead-card rule: at least one action, each with a valid via + safety.
  assert(`${kind}: >=1 action (no dead card)`, c.actions.length >= 1);
  const actionsOk = c.actions.every((a) => VALID_VIA.has(a.via.type) && VALID_SAFETY.has(a.safety) && a.label.length > 0);
  assert(`${kind}: every action well-formed`, actionsOk);
  // No-fake-action rule: a link_only action that doesn't act must NOT promise "Los op".
  const noFake = c.actions.every((a) => a.safety !== "link_only" || !/los op/i.test(a.label));
  assert(`${kind}: link_only never labelled "Los op"`, noFake);
}

// Ranking is preserved: mapping a ranked list keeps non-decreasing priority.
const ranked = rankAttentionItems(KINDS.map(sample));
const cards = ranked.map(toCard);
const monotonic = cards.every((c, i) => i === 0 || cards[i - 1].priority <= c.priority);
assert("toCard preserves rank order (priority non-decreasing)", monotonic);
assert("all 10 kinds map (lossless)", cards.length === KINDS.length);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
