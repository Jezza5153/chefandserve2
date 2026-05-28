/**
 * PR-3 smoke — travel-cost + margin engine. Run with tsx:
 *   npx tsx scripts/smoke-travel.mts
 * The estimate + margin math is pure (always tested). geocodeNL hits PDOK
 * (keyless) — asserted if reachable, skipped gracefully if offline/CI.
 */

const t = await import("@/lib/domain/travel");
const geo = await import("@/lib/domain/geo");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

console.log("=== PR-3 travel + margin smoke ===\n");

console.log("── haversine + estimate (pure) ──");
const amsterdam = { lat: 52.3676, lng: 4.9041 };
const haarlem = { lat: 52.3874, lng: 4.6462 };
const straight = geo.haversineKm(amsterdam, haarlem);
assert("haversine Amsterdam–Haarlem ~17-19 km", straight > 16 && straight < 20, straight.toFixed(1));

const car = t.estimateTravel({ from: amsterdam, to: haarlem, mode: "car" });
assert("car km = straight × 1.3", Math.abs(car.km - Math.round(straight * 1.3 * 10) / 10) < 0.05, String(car.km));
assert("roundTripKm = 2 × km", Math.abs(car.roundTripKm - car.km * 2) < 0.05);
assert("car cost = roundTrip × €0,23", car.costCents === Math.round(car.roundTripKm * 23), String(car.costCents));
assert("car basis mentions auto", car.basis.includes("auto"));

const ov = t.estimateTravel({ from: amsterdam, to: haarlem, mode: "none" });
assert("OV basis = NS-schatting", ov.basis.includes("NS-schatting"));
assert("OV cost = roundTrip × €0,18", ov.costCents === Math.round(ov.roundTripKm * 18));
const ebike = t.estimateTravel({ from: amsterdam, to: haarlem, mode: "ebike" });
assert("ebike cheaper than car", ebike.costCents < car.costCents);
assert("null mode defaults to OV rate", t.estimateTravel({ from: amsterdam, to: haarlem, mode: null }).costCents === ov.costCents);

console.log("\n── margin (pure) ──");
const m1 = t.estimateMargin({ clientRateCents: 4500, chefRateCents: 2800, hours: 5, travelCents: 1000 });
assert("revenue = 4500×5", m1.revenueCents === 22500);
assert("chef cost = 2800×5", m1.chefCostCents === 14000);
assert("margin = 22500-14000-1000", m1.marginCents === 7500);
assert("healthy margin → ok", m1.tone === "ok");
const m2 = t.estimateMargin({ clientRateCents: 3000, chefRateCents: 2500, hours: 5, travelCents: 1500 });
assert("thin margin → low", m2.tone === "low", `margin ${m2.marginCents} ratio ${(m2.marginCents / m2.revenueCents).toFixed(2)}`);
const m3 = t.estimateMargin({ clientRateCents: 2500, chefRateCents: 2800, hours: 5, travelCents: 1000 });
assert("loss → negative", m3.tone === "negative" && m3.marginCents < 0);
assert("eur formats Dutch", t.eur(2350) === "€23,50");

console.log("\n── geocode (PDOK, network — graceful) ──");
const ll = await geo.geocodeNL("1012AB", "1");
if (ll) {
  assert("postcode geocoded to NL bounds", ll.lat > 50 && ll.lat < 54 && ll.lng > 3 && ll.lng < 8, JSON.stringify(ll));
} else {
  console.log("  ⚠ PDOK unreachable — geocode assertion skipped (engine math already verified)");
}

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
