/**
 * Import chefs from the old system's Medewerkers.csv export (semicolon-delimited).
 *
 *   npx tsx --env-file=<env> scripts/import-medewerkers.ts --file=path.csv           # DRY RUN
 *   npx tsx --env-file=<env> scripts/import-medewerkers.ts --file=path.csv --execute # writes
 *
 * DESIGN
 * - Dry-run by default: prints the mapping census, writes nothing.
 * - --execute requires the PROD host (ep-icy-scene): real personnel data belongs on the
 *   system of record only — never on the shared dev branch.
 * - Idempotent on lower(email): existing chefs are SKIPPED, never overwritten — a re-run
 *   after a partial import is safe, and the pre-existing roster is untouched.
 * - BSN + IBAN go through encryptPii (AES-256-GCM) — never plaintext (AVG hard rule).
 *   "Medewerker ID" from the old system is deliberately dropped (owner's call).
 * - One summary audit row (chefs.import) — not 204 separate rows.
 *
 * MAPPING (old system → chefs)
 * - Positie-kolommen (one column per old-system tag, value "Ja"/nonempty = has it) →
 *   the HIGHEST vakniveau across their tags + curated skillTags + preferences.
 * - Dienstverband: "Zzp" → zzp · "Uitzendkracht" → payroll · both → both.
 * - Pools=Ja → languages ["PL"] (the old system tracked no other languages; we do NOT
 *   assume NL — unknown stays unknown).
 * - Inschrijfreferentie (+detail) → notes ("Bron: …") — recruitment provenance is intel.
 * - Bedrijfsnaam (ZZP) → notes. Geslacht → gender. Geboorteplaats/nieuwsbrief/KOR: dropped.
 * - Privacy-foto-delen: recorded in notes so document clientVisible decisions can honor it.
 */
import { readFileSync } from "node:fs";

import { and, eq, isNull, sql as dsql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import { encryptPii } from "@/lib/crypto";
import { recordAuditCore } from "@/lib/audit";
import { sanitizeSkillTags } from "@/lib/domain/skill-tags";

/* ----- CLI ------------------------------------------------------------------ */
const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const fileArg = args.find((a) => a.startsWith("--file="))?.slice(7);
if (!fileArg) {
  console.error("Usage: import-medewerkers.ts --file=path.csv [--execute]");
  process.exit(2);
}

/* ----- tiny csv (semicolon, quoted) ---------------------------------------- */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ";") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const header = parseLine(lines[0]!).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const vals = parseLine(l);
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = (vals[i] ?? "").trim()));
    return row;
  });
}

/* ----- mapping tables ------------------------------------------------------- */
/** Old-system position columns → vakniveau (rank = seniority; highest wins). */
const VAKNIVEAU_RANK: [string, string, number][] = [
  // [column-substring (lowercased), vakniveau, rank]
  ["keukenassistent", "keukenhulp", 1],
  ["bediening", "bediening", 2],
  ["front of house", "bediening", 2],
  ["perfect serve", "bediening", 2],
  ["breakfast", "breakfast", 3],
  ["pizzaiolo", "chef_de_partie", 4],
  ["zzp basis", "chef_de_partie", 4],
  ["zzp cdp", "chef_de_partie", 4],
  ["zelfstandig werkend kok", "chef_de_partie", 4],
  ["zelfstanding werkend", "chef_de_partie", 4], // old-system typo variants
  ["zelfstanding wekend", "chef_de_partie", 4],
  ["zelfstainding werkend", "chef_de_partie", 4],
  ["zzp+", "chef_de_partie", 4],
  ["zzp++", "chef_de_partie", 4],
  ["bakery zelfstandig", "chef_de_partie", 4],
  ["souschef", "sous_chef", 5],
  ["sous chef", "sous_chef", 5],
  ["chef kok", "chef_de_cuisine", 6],
  ["head chef", "chef_de_cuisine", 6],
  ["event manager", "banqueting", 4],
];

/** Old-system columns → curated skill tags (sanitizeSkillTags validates). */
const SKILL_MAP: [string, string][] = [
  ["banqueting", "banqueting"],
  ["bbq", "grill"],
  ["breakfast", "ontbijt"],
  ["michelin", "fine_dining"],
  ["hotels", "hotel"],
  ["event manager", "events"],
  ["souschef", "leidinggevend"],
  ["sous chef", "leidinggevend"],
  ["head chef", "leidinggevend"],
  ["chef kok", "leidinggevend"],
  ["front of house", "gastvrijheid"],
  ["perfect serve", "gastvrijheid"],
  ["bediening", "gastvrijheid"],
];

/** Old-system columns → preferences keys (schema: bbq/breakfast/banqueting/beachclub/early_shifts/hotels/restaurants/michelin/flexible). */
const PREF_MAP: [string, string][] = [
  ["bbq", "bbq"],
  ["breakfast", "breakfast"],
  ["banqueting", "banqueting"],
  ["early shifts", "early_shifts"],
  ["hotels", "hotels"],
  ["michelin", "michelin"],
];

const yes = (v: string | undefined): boolean => {
  const s = (v ?? "").trim().toLowerCase();
  return s !== "" && s !== "nee" && s !== "no" && s !== "0" && s !== "false";
};

function normPostcode(raw: string): string | null {
  const up = raw.trim().toUpperCase();
  if (!up) return null;
  const m = up.replace(/\s+/g, "").match(/^(\d{4})([A-Z]{2})$/);
  return m ? `${m[1]} ${m[2]}` : up; // foreign/odd postcodes kept verbatim (never dropped)
}

function normDate(raw: string): string | null {
  // dd-mm-yyyy (one row has dd-mm--yyyy) → yyyy-mm-dd
  const m = raw.trim().match(/^(\d{2})-(\d{2})--?(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = Number(dd), mo = Number(mm), y = Number(yyyy);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1920 || y > 2015) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function normPhone(mobiel: string, telefoon: string): string | null {
  const raw = (mobiel || telefoon).trim();
  if (!raw) return null;
  const digits = raw.replace(/[^+\d]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("06") && digits.length === 10) return `+31${digits.slice(1)}`;
  if (digits.startsWith("316") && digits.length === 11) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  return digits; // keep verbatim rather than guess
}

/* ----- main ----------------------------------------------------------------- */
async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "?";
  console.log(`host: ${host} · mode: ${EXECUTE ? "EXECUTE" : "dry-run"}`);
  if (EXECUTE && !host.includes("ep-icy-scene")) {
    console.error("REFUSING --execute: real personnel data belongs on prod (ep-icy-scene) only.");
    process.exit(2);
  }

  const rows = parseCsv(readFileSync(fileArg!, "utf-8"));
  console.log(`csv rows: ${rows.length}`);

  // Existing emails (idempotency key) — never overwrite.
  const existing = await db
    .select({ email: chefs.email })
    .from(chefs)
    .where(and(isNull(chefs.deletedAt), dsql`${chefs.email} is not null`));
  const existingEmails = new Set(existing.map((r) => r.email!.toLowerCase()));

  const positionCols = Object.keys(rows[0] ?? {}).filter((k) => {
    const lk = k.trim().toLowerCase();
    return (
      VAKNIVEAU_RANK.some(([sub]) => lk.includes(sub)) ||
      SKILL_MAP.some(([sub]) => lk.includes(sub)) ||
      PREF_MAP.some(([sub]) => lk.includes(sub))
    );
  });

  let inserted = 0, skippedExisting = 0, skippedNoEmail = 0;
  const stats = { vakniveau: new Map<string, number>(), withDob: 0, withBsn: 0, withIban: 0, withPostcode: 0, withPhone: 0, withSkills: 0, zzp: 0, payroll: 0, both: 0 };

  for (const r of rows) {
    const email = (r["E-mail"] ?? "").trim().toLowerCase();
    if (!email) { skippedNoEmail++; continue; }
    if (existingEmails.has(email)) { skippedExisting++; continue; }
    existingEmails.add(email); // in-file dedupe too

    // positions → vakniveau (highest rank wins) + skills + preferences
    let vak: string | null = null;
    let vakRank = 0;
    const skills = new Set<string>();
    const prefs = new Set<string>();
    for (const col of positionCols) {
      if (!yes(r[col])) continue;
      const lk = col.trim().toLowerCase();
      for (const [sub, v, rank] of VAKNIVEAU_RANK) {
        if (lk.includes(sub) && rank > vakRank) { vak = v; vakRank = rank; }
      }
      for (const [sub, tag] of SKILL_MAP) if (lk.includes(sub)) skills.add(tag);
      for (const [sub, pref] of PREF_MAP) if (lk.includes(sub)) prefs.add(pref);
    }
    const skillTags = sanitizeSkillTags([...skills]);

    const dv = (r["Dienstverband"] ?? "").toLowerCase();
    const employmentType = dv.includes("zzp") && dv.includes("uitzendkracht") ? "both" : dv.includes("zzp") ? "zzp" : dv.includes("uitzendkracht") ? "payroll" : null;
    if (employmentType === "zzp") stats.zzp++; else if (employmentType === "payroll") stats.payroll++; else if (employmentType === "both") stats.both++;

    const voornaam = r["Voornaam"] ?? "";
    const achternaam = r["Achternaam"] ?? "";
    const fullName = `${voornaam} ${achternaam}`.replace(/\s+/g, " ").trim();
    const dob = normDate(r["Geboortedatum"] ?? "");
    const postcode = normPostcode(r["Postcode"] ?? "");
    const phone = normPhone(r["Mobiel"] ?? "", r["Telefoon"] ?? "");
    const transportMode = yes(r["Motorbike"]) ? "motorbike" : yes(r["Electric bike"]) ? "ebike" : null;

    const noteParts: string[] = [];
    const bron = (r["Inschrijfreferentie"] ?? "").trim();
    const bronDetail = (r["Inschrijfreferentie detail"] ?? "").trim();
    if (bron) noteParts.push(`Bron: ${bron}${bronDetail ? ` (${bronDetail})` : ""}`);
    const bedrijf = (r["Bedrijfsnaam"] ?? "").trim();
    if (bedrijf) noteParts.push(`ZZP-bedrijf: ${bedrijf}`);
    if (yes(r["Privacy - foto delen met opdrachtgever"])) noteParts.push("Foto delen met opdrachtgever: akkoord (oud systeem)");
    if (yes(r["Heb je je autorijbewijs?"])) noteParts.push("Heeft autorijbewijs");
    noteParts.push("Geïmporteerd uit oud systeem (Medewerkers.csv)");

    if (vak) stats.vakniveau.set(vak, (stats.vakniveau.get(vak) ?? 0) + 1);
    if (dob) stats.withDob++;
    if (postcode) stats.withPostcode++;
    if (phone) stats.withPhone++;
    if (skillTags.length) stats.withSkills++;
    if ((r["BSN"] ?? "").trim()) stats.withBsn++;
    if ((r["IBAN"] ?? "").trim()) stats.withIban++;

    if (!EXECUTE) { inserted++; continue; }

    const bsnRaw = (r["BSN"] ?? "").trim();
    const ibanRaw = (r["IBAN"] ?? "").replace(/\s+/g, "").toUpperCase();
    await db.insert(chefs).values({
      fullName,
      firstName: voornaam || null,
      surname: achternaam || null,
      initials: (r["Voorletters"] ?? "").trim() || null,
      email,
      phone,
      gender: (r["Geslacht"] ?? "").trim() || null,
      nationality: (r["Nationaliteit"] ?? "").trim() || null,
      dateOfBirth: dob,
      street: (r["Adres"] ?? "").trim() || null,
      houseNumber: (r["Huisnummer"] ?? "").trim() || null,
      postcode,
      placeOfResidence: (r["Plaats"] ?? "").trim() || null,
      city: (r["Plaats"] ?? "").trim() || null,
      country: (r["Land"] ?? "").trim() || null,
      vakniveau: vak as never,
      skillTags: skillTags.length ? skillTags : null,
      preferences: prefs.size ? [...prefs] : null,
      languages: yes(r["Pools"]) ? ["PL"] : null,
      employmentType: employmentType as never,
      transportMode: transportMode as never,
      bsnEncrypted: bsnRaw ? await encryptPii(bsnRaw) : null,
      ibanEncrypted: ibanRaw ? await encryptPii(ibanRaw) : null,
      status: "active",
      notes: noteParts.join(" · "),
    });
    inserted++;
  }

  console.log(`\n  ${EXECUTE ? "inserted" : "WOULD insert"}: ${inserted}`);
  console.log(`  skipped (email already in system): ${skippedExisting}`);
  console.log(`  skipped (no email): ${skippedNoEmail}`);
  console.log(`  vakniveau:`, Object.fromEntries(stats.vakniveau));
  console.log(`  coverage: dob=${stats.withDob} postcode=${stats.withPostcode} phone=${stats.withPhone} skills=${stats.withSkills} bsn=${stats.withBsn} iban=${stats.withIban}`);
  console.log(`  dienstverband: zzp=${stats.zzp} payroll=${stats.payroll} both=${stats.both}`);

  if (EXECUTE && inserted > 0) {
    await recordAuditCore({
      userId: null as never,
      action: "chefs.import",
      resource: "chefs",
      resourceId: "medewerkers-csv",
      after: { inserted, skippedExisting, source: "Medewerkers.csv (oud systeem)" },
    }).catch((e) => console.error("audit failed (import itself succeeded):", e));
  }
}

main().then(() => process.exit(0));
