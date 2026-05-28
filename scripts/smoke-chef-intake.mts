/**
 * PR-2 smoke — chef Jotform extractor structures the rich fields (pure, no DB).
 *   npx tsx scripts/smoke-chef-intake.mts
 * Feeds a representative rawRequest (the real chef form's shape) and asserts
 * transport / preferences / address / employment / applying-as are mapped.
 */

const { extractChefSubmission } = await import("@/lib/intake/jotform");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

console.log("=== PR-2 chef-intake extractor smoke ===\n");

const body = {
  submissionID: "smoke-123",
  formID: "252442173847359",
  rawRequest: JSON.stringify({
    q1_name: { first: "Jan", last: "de Vries" },
    q2_email: "Jan@Example.com",
    q3_phone: "0612345678",
    q4_streetName: "Hoofdstraat",
    q5_houseNumber: "12",
    q6_zipCode: "1011AB",
    q7_transportation: "Car",
    q8_applyingAs: "Chef",
    q9_payrollZzp: "Both",
    q10_whatYouLikeMost: ["Breakfast", "BBQ", "Hotels"],
  }),
};

const r = extractChefSubmission(body);

console.log("── identity ──");
assert("fullName", r.fullName === "Jan de Vries", String(r.fullName));
assert("email lowercased", r.email === "jan@example.com", String(r.email));
assert("phone", r.phone === "0612345678");

console.log("\n── address ──");
assert("street", r.street === "Hoofdstraat", String(r.street));
assert("houseNumber", r.houseNumber === "12", String(r.houseNumber));
assert("postcode", r.postcode === "1011AB", String(r.postcode));

console.log("\n── structured intake ──");
assert("transportMode = car", r.transportMode === "car", String(r.transportMode));
assert("employmentType = both", r.employmentType === "both", String(r.employmentType));
assert("applyingAs = chef", r.applyingAs === "chef", String(r.applyingAs));
assert("preferences includes breakfast", (r.preferences ?? []).includes("breakfast"), JSON.stringify(r.preferences));
assert("preferences includes bbq", (r.preferences ?? []).includes("bbq"));
assert("preferences includes hotels", (r.preferences ?? []).includes("hotels"));

console.log("\n── transport mapping variants ──");
const tv = (t: string) => extractChefSubmission({ submissionID: "x", rawRequest: JSON.stringify({ q_transportation: t }) }).transportMode;
assert("Motorbike → motorbike", tv("Motorbike") === "motorbike");
assert("Electric bike → ebike", tv("Electric bike") === "ebike");
assert("No → none", tv("No") === "none");

console.log(`\n─────────────────────────────\n  ✓ pass: ${pass}\n  ✗ fail: ${fail}`);
if (fail > 0) process.exit(1);
console.log("\nSmoke OK ✓");
