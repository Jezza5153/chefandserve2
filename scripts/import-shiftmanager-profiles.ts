/**
 * Mining round 2 — the STRUCTURED profile fields from the old system's medewerker-form.
 *
 *   npx tsx --env-file=<env> scripts/import-shiftmanager-profiles.ts \
 *     --file=~/Downloads/shiftmanager-extract/sm-profiles.json [--execute]
 *
 * Round 1 (#338) moved the free-text knowledge into notes. This one fills the COLUMNS the
 * matcher actually filters on — the census showed them near-empty (languages 9/215,
 * hourlyRateMinCents 0/215, ownTransport 0/215) while the old system maintained them:
 *
 * - talen mét niveau (Zwak/Matig/Goed/Zeer goed) → chefs.languages[] as "NL (zeer goed)"
 *   (findChefs matches per element with ILIKE, so a plain "NL" query still hits)
 * - "globale functies" (role clearances)        → chefs.ownerTags[] (filterable in the
 *   chef directory) + chefs.segments[] where the mapping is unambiguous
 * - the ZZP rate TIERS inside those clearances  → chefs.hourlyRateMin/MaxCents. The tier
 *   names are priced in the klanten rate cards (ZZP cdp = €32,50 chef / €40 klant …), so
 *   a chef cleared for "ZZP cdp + ZZP++" earns €32,50–€37,50. This is the rate backfill
 *   WITHOUT guessing from prose — the audit's #1 missing matcher input.
 *
 * NEVER OVERWRITES owner-entered data: every field is filled only when currently empty
 * (arrays: empty; scalars: null). Idempotent — a second run is a no-op. Dry-run default,
 * --execute refuses anything but prod.
 */
import { readFileSync } from "node:fs";

import { eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import { recordAuditCore } from "@/lib/audit";

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const file = args.find((a) => a.startsWith("--file="))?.slice(7)?.replace(/^~/, process.env.HOME ?? "");
if (!file) {
  console.error("Usage: import-shiftmanager-profiles.ts --file=sm-profiles.json [--execute]");
  process.exit(2);
}

type Prof = {
  uid: string;
  email?: string;
  langs?: Record<string, string>;
  rijbewijs?: string[];
  auto?: string | null;
  voertaal?: string | null;
  functies?: string[];
  foto?: string | null;
};

/** Chef-side hourly rate per tier, in cents — read off the klanten rate cards. */
const TIER_CENTS: { re: RegExp; cents: number }[] = [
  { re: /^zzp\s*basis/i, cents: 2800 },
  { re: /^zzp\s*cdp/i, cents: 3250 },
  { re: /^zzp\s*\+\+/i, cents: 3750 },
  { re: /^zzp\s*\+$/i, cents: 3500 },
  { re: /^zzp\s*sous/i, cents: 4000 },
  { re: /^zzp\s*chef\s*kok/i, cents: 4500 },
  { re: /^front of house/i, cents: 2750 },
  { re: /^perfect serve/i, cents: 4250 },
];

/** Role clearances that map cleanly onto our segment vocabulary. Anything ambiguous
 *  stays an ownerTag only — a wrong segment silently steers the matcher wrong. */
const SEGMENT_MAP: { re: RegExp; segment: string }[] = [
  { re: /hotel/i, segment: "hotel" },
  { re: /michelin/i, segment: "michelin" },
  { re: /banqueting/i, segment: "banqueting" },
  { re: /breakfast/i, segment: "breakfast" },
  { re: /event/i, segment: "event" },
  { re: /bakery/i, segment: "bakery" },
];

// "zwak" is not a working language; "moedertaal" comes from the OVERIG free-text field
// and is the most valuable entry of all (a Spanish chef for a Spanish-speaking brigade).
const LEVEL_OK = /goed|matig|moedertaal/i;

function langArray(langs: Record<string, string> | undefined): string[] {
  if (!langs) return [];
  const out: string[] = [];
  for (const [code, level] of Object.entries(langs)) {
    if (!level || !LEVEL_OK.test(level)) continue;
    out.push(`${code} (${level.toLowerCase()})`);
  }
  return out;
}

function rateRange(functies: string[]): { min: number | null; max: number | null } {
  const hits = functies
    .map((f) => TIER_CENTS.find((t) => t.re.test(f.trim()))?.cents)
    .filter((c): c is number => typeof c === "number");
  if (hits.length === 0) return { min: null, max: null };
  return { min: Math.min(...hits), max: Math.max(...hits) };
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "?";
  console.log(`host: ${host} · mode: ${EXECUTE ? "EXECUTE" : "dry-run"}`);
  if (EXECUTE && !host.includes("ep-icy-scene")) {
    console.error("REFUSING --execute: profieldata hoort op prod (ep-icy-scene).");
    process.exit(2);
  }

  const profs = JSON.parse(readFileSync(file!, "utf-8")) as Prof[];
  const byEmail = new Map(profs.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p]));

  const rows = await db
    .select({
      id: chefs.id, fullName: chefs.fullName, email: chefs.email,
      languages: chefs.languages, ownerTags: chefs.ownerTags, segments: chefs.segments,
      rateMin: chefs.hourlyRateMinCents, rateMax: chefs.hourlyRateMaxCents,
    })
    .from(chefs)
    .where(isNull(chefs.deletedAt));

  let matched = 0, updated = 0;
  const filled = { languages: 0, tags: 0, segments: 0, rate: 0 };

  for (const c of rows) {
    const p = byEmail.get((c.email ?? "").toLowerCase());
    if (!p) continue;
    matched++;

    const set: Record<string, unknown> = {};

    // Languages MERGE (union) instead of fill-when-empty: a re-run must be able to add
    // a language the previous run's level-filter dropped, without ever deleting one the
    // owner typed. Everything else below stays strictly fill-when-empty.
    const langs = langArray(p.langs);
    const existingLangs = c.languages ?? [];
    const merged = [...existingLangs];
    for (const l of langs) {
      const key = l.split(" (")[0].toLowerCase();
      if (!merged.some((e) => e.toLowerCase().startsWith(key))) merged.push(l);
    }
    if (merged.length > existingLangs.length) { set.languages = merged; filled.languages++; }

    const functies = (p.functies ?? []).map((f) => f.trim()).filter(Boolean);
    if (functies.length && (c.ownerTags ?? []).length === 0) {
      set.ownerTags = functies.slice(0, 12);
      filled.tags++;
    }
    if (functies.length && (c.segments ?? []).length === 0) {
      const segs = [...new Set(functies.flatMap((f) => SEGMENT_MAP.filter((m) => m.re.test(f)).map((m) => m.segment)))];
      if (segs.length) { set.segments = segs; filled.segments++; }
    }

    // NB: vervoer wordt bewust NIET overgenomen. Het `auto`-veld staat in het oude
    // systeem op 0 voor álle 204 chefs (= niet onderhouden, niet "geen auto"), en een
    // rijbewijs is geen eigen vervoer. Liever leeg dan fout: de matcher rekent met
    // reistijd, dus een verzonnen "heeft auto" stuurt iemand naar de verkeerde klant.

    const { min, max } = rateRange(functies);
    if (min != null && c.rateMin == null) {
      set.hourlyRateMinCents = min;
      if (max != null && max !== min && c.rateMax == null) set.hourlyRateMaxCents = max;
      filled.rate++;
    }

    if (Object.keys(set).length === 0) continue;
    updated++;
    if (EXECUTE) {
      await db.update(chefs).set({ ...set, updatedAt: new Date() }).where(eq(chefs.id, c.id));
    }
  }

  console.log(`\nprofielen in bestand: ${profs.length} · gematcht op e-mail: ${matched}`);
  console.log(`${EXECUTE ? "bijgewerkt" : "ZOU bijwerken"}: ${updated} chefs`);
  console.log(
    `  talen +${filled.languages} · eigen labels (functie-clearances) +${filled.tags} · segmenten +${filled.segments} · tarief +${filled.rate}`,
  );

  if (EXECUTE && updated > 0) {
    await recordAuditCore({
      userId: null as never,
      action: "chefs.import_profiles",
      resource: "chefs",
      resourceId: "shiftmanager-profiles",
      after: { updated, ...filled, source: "ShiftManager medewerker-form (read-only extract)" },
    }).catch((e) => console.error("audit failed (import ok):", e));
  }
}

main().then(() => process.exit(0));
