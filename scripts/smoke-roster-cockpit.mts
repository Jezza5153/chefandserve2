/**
 * roster-intel (cockpit engine) smoke — pure, no DB.
 *   npx tsx scripts/smoke-roster-cockpit.mts
 *
 * Locks the active-fill rule (gevuld = confirmed ≥ headcount; openSlots =
 * headcount − (confirmed+accepted); completed never inflates a future shift),
 * KPI math, dagdeel, attention ordering + self-explanation, overlaps,
 * open-binnen-48u, month heatmap buckets, and the rosterAiSummary shape.
 * (roster-format's own helpers are covered by smoke-roster-intel.mts.)
 */

const m = await import("@/lib/domain/roster-intel");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log("  ✓", name);
    pass++;
  } else {
    console.log("  ✗", name, detail ? `— ${detail}` : "");
    fail++;
  }
}

const NOW = new Date("2026-05-29T09:00:00Z"); // 11:00 Amsterdam (CEST)
const today = "2026-05-29";

type Row = m.RosterShiftRow;
const mk = (o: Partial<Row> & Pick<Row, "id" | "startsAt" | "endsAt">): Row => ({
  roleNeeded: "chef_de_partie",
  headcount: 2,
  status: "open",
  location: "Damrak 1",
  city: "Amsterdam",
  clientId: "c1",
  companyName: "Hotel Okura",
  confirmedCount: 0,
  acceptedCount: 0,
  proposedCount: 0,
  ...o,
});

console.log("=== roster-intel cockpit smoke ===\n");

console.log("── dagdeel buckets ──");
assert("08:00 → ontbijt", m.dagdeelOf("2026-05-29T06:00:00Z") === "ontbijt");
assert("13:00 → lunch", m.dagdeelOf("2026-05-29T11:00:00Z") === "lunch");
assert("19:00 → diner", m.dagdeelOf("2026-05-29T17:00:00Z") === "diner");
assert("23:00 → late", m.dagdeelOf("2026-05-29T21:00:00Z") === "late");

console.log("\n── active-fill rule ──");
const gevuld = m.shiftFill(mk({ id: "s1", startsAt: "2026-05-29T16:00:00Z", endsAt: "2026-05-29T21:00:00Z", confirmedCount: 2 }), undefined, NOW);
assert("confirmed≥headcount → gevuld, 0 open", gevuld.gevuld && gevuld.openSlots === 0);
const accCover = m.shiftFill(mk({ id: "s2", startsAt: "2026-06-05T16:00:00Z", endsAt: "2026-06-05T21:00:00Z", confirmedCount: 0, acceptedCount: 2 }), undefined, NOW);
assert("accepted covers → 0 open, NOT gevuld, teBevestigen", accCover.openSlots === 0 && !accCover.gevuld && accCover.teBevestigen);
const partial = m.shiftFill(mk({ id: "s3", startsAt: "2026-06-05T16:00:00Z", endsAt: "2026-06-05T21:00:00Z", confirmedCount: 1 }), undefined, NOW);
assert("1/2 confirmed → 1 open, not gevuld", partial.openSlots === 1 && !partial.gevuld && !partial.teBevestigen);
const past = m.shiftFill(mk({ id: "s4", startsAt: "2026-05-20T16:00:00Z", endsAt: "2026-05-20T21:00:00Z", status: "completed" }), undefined, NOW);
assert("completed/past → done (never inflates fill)", past.health === "done");

// Today rows for the Day view (a today-0-confirmed shift is correctly critical).
const g = mk({ id: "g", startsAt: "2026-05-29T16:00:00Z", endsAt: "2026-05-29T21:00:00Z", confirmedCount: 2 }); // gevuld diner
const u = mk({ id: "u", startsAt: "2026-05-29T17:00:00Z", endsAt: "2026-05-29T22:00:00Z", confirmedCount: 1 }); // onderbezet diner (1 open)
const k = mk({ id: "k", startsAt: "2026-05-29T11:00:00Z", endsAt: "2026-05-29T15:00:00Z", headcount: 1, confirmedCount: 0 }); // kritiek lunch (1 open)
const p = mk({ id: "p", startsAt: "2026-05-31T06:00:00Z", endsAt: "2026-05-31T10:00:00Z", headcount: 1, confirmedCount: 0, proposedCount: 1, earliestProposedAt: "2026-05-27T07:00:00Z" }); // future ontbijt, proposed

console.log("\n── day fill tone (confirmed-driven, softer than health) ──");
assert("2/2 → vol", m.dayToneOf(2, 2) === "vol");
assert("1/2 → deels (amber, not red)", m.dayToneOf(1, 2) === "deels");
assert("0/1 → leeg (red)", m.dayToneOf(0, 1) === "leeg");

console.log("\n── Day view KPIs (Totaal · Ingevuld · Open · Kritiek · Chefs · Beschikbaar) ──");
const day = m.buildRosterView({
  view: "day", dateKey: today, rows: [g, u, k], now: NOW,
  availableChefs: [{ id: "a", fullName: "Sara", skills: ["ontbijt"] }, { id: "b", fullName: "Marco", skills: ["diner"] }],
});
const kpi = (key: string) => day.kpis.find((x) => x.key === key);
assert("totaal diensten = 3", kpi("totaal")?.value === 3);
assert("ingevuld (vol g) = 1", kpi("ingevuld")?.value === 1);
assert("open (deels u) = 1", kpi("open")?.value === 1);
assert("kritiek (leeg k) = 1", kpi("kritiek")?.value === 1);
assert("ingevuld+open+kritiek partition totaal", (kpi("ingevuld")!.value + kpi("open")!.value + kpi("kritiek")!.value) === kpi("totaal")!.value);
assert("open KPI carries a pct badge", typeof kpi("open")?.pct === "number");
assert("open KPI is a clickable filter", kpi("open")?.filter === "open");
assert("chefs ingepland = 3 (g2 + u1 + k0)", kpi("chefs")?.value === 3);
assert("beschikbare chefs = 2", kpi("beschikbaar")?.value === 2);
assert("open-binnen-48u = 2 (u,k today)", day.openBinnen48u === 2, String(day.openBinnen48u));
assert("day groups 1 hotel, 3 shifts", (day.dayHotels?.length ?? 0) === 1 && day.dayHotels![0].shifts.length === 3);
assert("beschikbaar skill split", day.beschikbaarNietIngepland?.bySkill["ontbijt"] === 1 && day.beschikbaarNietIngepland?.bySkill["diner"] === 1);

console.log("\n── attention (ranked + self-explaining) ──");
assert("attention non-empty", day.attention.length > 0);
assert("critical ranked first", day.attention[0].kind === "critical_shift");
assert("every item self-explains (detail)", day.attention.every((a) => Boolean(a.detail && a.detail.length > 0)));
const attP = m.buildAttention([p], undefined, NOW);
assert("future proposed → open_shift + no-response", attP.some((a) => a.kind === "open_shift") && attP.some((a) => a.kind === "proposed_no_response" && /geen reactie/.test(a.detail ?? "")));

console.log("\n── overlaps ──");
const overlaps = m.detectOverlaps([
  { chefId: "x", chefName: "Mike", shiftId: "s1", startsAt: "2026-05-29T16:00:00Z", endsAt: "2026-05-29T20:00:00Z" },
  { chefId: "x", chefName: "Mike", shiftId: "s2", startsAt: "2026-05-29T19:00:00Z", endsAt: "2026-05-29T23:00:00Z" },
  { chefId: "y", chefName: "Ann", shiftId: "s3", startsAt: "2026-05-29T08:00:00Z", endsAt: "2026-05-29T12:00:00Z" },
]);
assert("detects 1 overlap (Mike)", overlaps.length === 1 && overlaps[0].chefName === "Mike");

console.log("\n── Week view ──");
const week = m.buildRosterView({ view: "week", dateKey: today, rows: [g, u, k, p], now: NOW });
assert("hotels-met-aandacht counted", (week.hotelsMetAandacht?.count ?? 0) === 1);
assert("week KPI 'hotels' present", week.kpis.some((x) => x.key === "hotels"));
assert("week hotel row has cells", (week.weekHotels?.[0]?.cells.length ?? 0) >= 1);

console.log("\n── Month view ──");
const month = m.buildRosterView({ view: "month", dateKey: today, rows: [g, u, k], now: NOW });
const cell = m.monthCellFor(month, today, true);
assert("month cell bezetting% + bucket", cell.bezettingPct === 60 && cell.bucket === "low", `${cell.bezettingPct}/${cell.bucket}`);
assert("month cell flags kritiek day", cell.kritiek === true);
assert("hardest role surfaced", Boolean(month.hardestRole) && month.hardestRole!.open > 0);
assert("top client pressure surfaced", month.topClientPressure?.companyName === "Hotel Okura");
assert("month KPI moeilijkste-rol present", month.kpis.some((x) => x.key === "moeilijkste-rol"));

console.log("\n── AI summary (same object the screen renders) ──");
const ai = m.rosterAiSummary(day);
assert("ai summary text non-empty", ai.text.length > 0, ai.text);
assert("ai facts carry kpis + view", Array.isArray(ai.facts.kpis) && ai.facts.view === "day");

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
