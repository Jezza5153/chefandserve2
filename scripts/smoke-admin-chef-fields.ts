/**
 * Smoke: the admin write path for the fields matching depends on.
 *
 * WHY. `chefs.skill_tags` is the curated vocabulary the matcher scores on and the assistant
 * filters by — and it was empty for the ENTIRE production roster, because the only writer in
 * the codebase was the chef's own availability page. Maarten could not tag a chef himself,
 * so the column stayed null and tag scoring had nothing to score.
 *
 * This exercises the pieces the admin form now depends on: the vocabulary is well-formed,
 * sanitizeSkillTags rejects anything outside it (a stale checkbox must not poison the
 * column), and a round-trip write/read of the array actually persists.
 *
 *   npx tsx --env-file=.env.local scripts/smoke-admin-chef-fields.ts
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import { SKILL_TAGS, sanitizeSkillTags, skillTagsByCategory } from "@/lib/domain/skill-tags";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "?";
  if (host.includes("ep-icy-scene")) { console.error("REFUSING: production. Dev only."); process.exit(2); }
  console.log(`=== admin skill-tag write path (${host}) ===\n`);

  console.log("vocabulary:");
  const keys = SKILL_TAGS.map((t) => t.key);
  ok("keys are unique", new Set(keys).size === keys.length);
  ok("keys are stable snake_case", keys.every((k) => /^[a-z][a-z0-9_]*$/.test(k)),
     keys.filter((k) => !/^[a-z][a-z0-9_]*$/.test(k)).join(", "));
  ok("every tag has a label", SKILL_TAGS.every((t) => t.label.length > 0));
  const grouped = skillTagsByCategory();
  ok("grouping loses no tag", grouped.reduce((n, g) => n + g.tags.length, 0) === SKILL_TAGS.length);
  ok("every group has a label", grouped.every((g) => g.label.length > 0));

  console.log("\nsanitize (the form posts raw strings — nothing outside the vocabulary may land):");
  ok("keeps valid keys", sanitizeSkillTags(["patisserie", "banqueting"]).length === 2);
  ok("drops unknown keys", sanitizeSkillTags(["patisserie", "not_a_real_tag"]).join() === "patisserie");
  ok("drops empty + junk", sanitizeSkillTags(["", "  ", "<script>"]).length === 0);
  ok("dedupes", sanitizeSkillTags(["grill", "grill"]).length === 1);
  ok("empty in, empty out", sanitizeSkillTags([]).length === 0);

  console.log("\nround-trip against the real column:");
  const [victim] = await db.select({ id: chefs.id, skillTags: chefs.skillTags }).from(chefs).limit(1);
  if (!victim) {
    console.log("  – no chefs on this branch; skipping the DB round-trip");
  } else {
    const original = victim.skillTags;
    try {
      const want = sanitizeSkillTags(["patisserie", "allergenen", "bogus"]);
      await db.update(chefs).set({ skillTags: want }).where(eq(chefs.id, victim.id));
      const [after] = await db.select({ skillTags: chefs.skillTags }).from(chefs).where(eq(chefs.id, victim.id));
      ok("array persists and reads back", (after?.skillTags ?? []).join() === want.join(),
         `got ${JSON.stringify(after?.skillTags)}`);
      ok("the invalid tag never reached the DB", !(after?.skillTags ?? []).includes("bogus"));

      await db.update(chefs).set({ skillTags: null }).where(eq(chefs.id, victim.id));
      const [cleared] = await db.select({ skillTags: chefs.skillTags }).from(chefs).where(eq(chefs.id, victim.id));
      ok("clearing to null works (the form posting nothing)", cleared?.skillTags == null);
    } finally {
      // Always put the row back the way we found it.
      await db.update(chefs).set({ skillTags: original }).where(eq(chefs.id, victim.id));
      console.log("  ↳ restored the test chef's original tags");
    }
  }

  console.log("\naddress + travel radius (the other fields the office could not write):");
  {
    // Mirrors the normalisation in the server action: "1011ab" / "1011 AB" → "1011 AB",
    // so geocode-backfill always gets the shape PDOK expects.
    const norm = (raw: string) => {
      const up = raw.trim().toUpperCase();
      const m = up.replace(/\s+/g, "").match(/^(\d{4})([A-Z]{2})$/);
      return m ? `${m[1]} ${m[2]}` : up || null;
    };
    ok("lowercase no-space postcode normalises", norm("1011ab") === "1011 AB");
    ok("already-correct postcode is unchanged", norm("1011 AB") === "1011 AB");
    ok("extra whitespace is collapsed", norm("  1011   ab ") === "1011 AB");
    ok("a non-Dutch postcode is kept verbatim, not silently dropped", norm("SW1A 1AA") === "SW1A 1AA");
    ok("empty becomes null", norm("   ") === null);
  }
  {
    const [c] = await db
      .select({ id: chefs.id, postcode: chefs.postcode, travelRadiusKm: chefs.travelRadiusKm })
      .from(chefs).limit(1);
    if (c) {
      const before = { postcode: c.postcode, travelRadiusKm: c.travelRadiusKm };
      try {
        await db.update(chefs).set({ postcode: "1011 AB", travelRadiusKm: 25 }).where(eq(chefs.id, c.id));
        const [after] = await db
          .select({ postcode: chefs.postcode, travelRadiusKm: chefs.travelRadiusKm })
          .from(chefs).where(eq(chefs.id, c.id));
        ok("postcode persists", after?.postcode === "1011 AB");
        ok("travel radius persists as a number", after?.travelRadiusKm === 25);
      } finally {
        await db.update(chefs).set(before).where(eq(chefs.id, c.id));
        console.log("  ↳ restored the test chef's address fields");
      }
    }
  }

  console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
