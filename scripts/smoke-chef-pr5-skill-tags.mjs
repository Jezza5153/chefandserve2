/**
 * Smoke — chef PR-5 skill-tag taxonomy + matching boost. Read-only + non-mutating.
 *
 * 1. Migration 0064 column present (chefs.skill_tags, array).
 * 2. sanitizeSkillTags + skillTagOverlap + tagsAdjust logic (mirrors
 *    src/lib/domain/skill-tags.ts + matching.ts) behaves correctly: stale/free-text
 *    keys dropped, overlap is case-insensitive, the boost is soft (+6%/tag, cap +18%,
 *    clamp 100) and a no-op when nothing matches.
 *
 * Run (dev only): node --env-file=.env.local scripts/smoke-chef-pr5-skill-tags.mjs
 * Plain JS so it runs under node directly (tsx is unreliable on Node 25 here).
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";
if (!url) throw new Error("No DATABASE_URL — run via: node --env-file=.env.local scripts/...");
if (!/ep-green-mouse/.test(url)) {
  throw new Error(`Refusing: smoke runs against DEV (ep-green-mouse) only. Host looks like: ${(url.match(/@([^/]+)/) || [])[1]}`);
}
const sql = neon(url);
let failures = 0;
const ok = (label, pass) => {
  console.log(`${pass ? "✓" : "✗"} ${label}`);
  if (!pass) failures++;
};

// 1 — column present
const col = await sql`
  SELECT data_type FROM information_schema.columns
  WHERE table_name='chefs' AND column_name='skill_tags'`;
ok("chefs.skill_tags column present (ARRAY)", col[0]?.data_type === "ARRAY");

// Mirror the vocabulary subset + helpers (keys must match skill-tags.ts).
const VALID = new Set([
  "fine_dining", "a_la_carte", "patisserie", "grill", "koude_keuken", "sauzen", "wereldkeuken",
  "banqueting", "events", "hotel", "ontbijt", "zorg", "hoog_volume",
  "allergenen", "halal", "vegan_vegetarisch", "medische_dieten",
  "leidinggevend", "gastvrijheid", "wijn_pairing",
]);
const sanitize = (tags) => {
  const seen = new Set(), out = [];
  for (const t of tags ?? []) {
    const k = String(t).trim().toLowerCase();
    if (VALID.has(k) && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
};
const overlap = (chefTags, reqTags) => {
  const chefKeys = sanitize(chefTags);
  if (!chefKeys.length || !reqTags?.length) return [];
  const want = new Set(reqTags.map((t) => String(t).trim().toLowerCase()));
  return chefKeys.filter((k) => want.has(k));
};
const tagsAdjust = (base, chefTags, reqTags) => {
  const m = overlap(chefTags, reqTags);
  if (!m.length) return base;
  return Math.min(100, Math.round(base * (1 + Math.min(0.18, m.length * 0.06))));
};

// 2 — sanitize
ok("sanitize drops free text / stale keys",
  JSON.stringify(sanitize(["banqueting", "vrij verzonnen", "PATISSERIE"])) === JSON.stringify(["banqueting", "patisserie"]));
ok("sanitize dedupes", JSON.stringify(sanitize(["grill", "grill"])) === JSON.stringify(["grill"]));

// overlap
ok("overlap case-insensitive", JSON.stringify(overlap(["banqueting"], ["Banqueting", "events"])) === JSON.stringify(["banqueting"]));
ok("no overlap → empty", overlap(["patisserie"], ["events"]).length === 0);
ok("empty chef tags → empty", overlap([], ["events"]).length === 0);

// tagsAdjust (soft)
ok("no match → unchanged", tagsAdjust(80, ["patisserie"], ["events"]) === 80);
ok("1 match → +6% (80→85)", tagsAdjust(80, ["banqueting"], ["banqueting"]) === 85);
ok("3 matches → +18% (80→94)", tagsAdjust(80, ["banqueting", "events", "hotel"], ["banqueting", "events", "hotel"]) === 94);
ok("4 matches still capped at +18% (80→94)", tagsAdjust(80, ["banqueting", "events", "hotel", "ontbijt"], ["banqueting", "events", "hotel", "ontbijt"]) === 94);
ok("boost clamps at 100", tagsAdjust(96, ["banqueting", "events", "hotel"], ["banqueting", "events", "hotel"]) === 100);

console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
