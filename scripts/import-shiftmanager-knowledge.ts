/**
 * Inject the knowledge mined from the OLD system (ShiftManager Pro) into prod profiles.
 *
 *   npx tsx --env-file=<env> scripts/import-shiftmanager-knowledge.ts \
 *     --chefs=~/Downloads/shiftmanager-extract/sm-chefs.json \
 *     --klanten=~/Downloads/shiftmanager-extract/sm-klanten.json [--execute]
 *
 * WHAT THIS IS. The old system held years of institutional memory that the CSV exports
 * did NOT contain: per-chef "communicatie" cards (intakes, preferences, character reads,
 * who-knows-who, tarief history), per-chef worked-hours totals, and per-klant favorieten/
 * blacklists (met redenen), briefings (kleding/parkeren/messen), tarieven and relatie-
 * historie. Extracted read-only via the browser session (2026-07-27); the JSON inputs
 * live OUTSIDE the repo (~/Downloads/shiftmanager-extract/) because the notes contain
 * personal detail that does not belong in git — same rule as the Medewerkers.csv.
 *
 * WHERE IT LANDS (all AI-reachable):
 * - chefs.notes    ← dated communicatie notes + oud-systeem stats line. `chefs.notes` is
 *                    a RAG source (admin-scoped), so this feeds semantic search directly.
 * - clients.notes  ← voorwaarden, vestigingen, tarieven, briefings, favorieten/blacklist
 *                    (met redenen), relatie-historie. Also a RAG source.
 * - clients.paymentTermsDays ← oud-systeem betaaltermijn (only when currently NULL).
 * - clients.favoriteChefIds / blockedChefIds ← old favorieten/blacklist rows whose chef
 *   name matches a prod chef (merged, deduped). Unmatched names stay in the notes text.
 * - clients.chefMustBring / parkingAvailable ← conservative extraction from briefings
 *   (only when currently NULL; regex must be unambiguous, else untouched).
 *
 * Matching: chefs by lower(email) (fullName fallback), klanten by exact companyName plus
 * an explicit map for the two multi-venue companies (Baut ×4, Park plaza ×2). Baut Oost
 * exists in the old system but has no prod client (no contacts in the export) — its
 * address survives in the notes of the other Baut venues.
 *
 * Idempotent: a profile whose notes already contain the "ShiftManager" marker is skipped
 * wholesale. Never overwrites: notes append; scalars only fill NULL; arrays merge.
 */
import { readFileSync } from "node:fs";

import { eq, isNull, sql as dsql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients } from "@/lib/db/schema";
import { recordAuditCore } from "@/lib/audit";

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1]?.replace(/^~/, process.env.HOME ?? "");
const chefsPath = arg("chefs");
const klantenPath = arg("klanten");
if (!chefsPath || !klantenPath) {
  console.error("Usage: import-shiftmanager-knowledge.ts --chefs=sm-chefs.json --klanten=sm-klanten.json [--execute]");
  process.exit(2);
}

const MARKER = "Oud systeem (ShiftManager";
const HEADER = "═══ Oud systeem (ShiftManager, overgezet 2026-07-27) ═══";

type SmChef = {
  uid: string; persnr: string; name: string; city: string; dienstverband: string | null; email?: string;
  stats: { invites: number; minutes: number; rating: number; ratingCount: number } | null;
  notes: { date: string; by: string; text: string }[];
};
type SmKlant = {
  cid: string; name: string; alg: string | null; paymentTerm: number | null; payrollPerc: number | null;
  vestigingen: { naam: string; straat: string; nummer: string; postcode: string; plaats: string }[];
  contacten: string[]; tarieven: string[]; briefings: string[]; favorieten: string[];
  blacklist: { name: string; reason: string | null }[]; communicatie: string[];
};

/** Old company name → prod companyName(s). Everything not listed maps by exact name. */
const MULTI_MAP: Record<string, string[]> = {
  "Baut B.V.": ["Baut B.V. — Backstage", "Baut B.V. — Baut Carre", "Baut B.V. — Baut Zuid", "Baut B.V. — Feadship"],
  "Park plaza HOTEL": ["Park plaza HOTEL — Park Plaza Amsterdam Airoport", "Park plaza HOTEL — Park Plaza Vondelpark"],
  // the extract header shortened this one; prod carries the full debiteur name
  "Art Ventura": ["Art Ventura | Art Events b.v."],
};
/** Venue-scoped relationship rows for the multi-venue klanten (from the raw extract). */
const VENUE_SCOPED_FAVS: Record<string, Record<string, string[]>> = {
  "Baut B.V.": { "Uriel D'agostino": ["Baut B.V. — Feadship"] },
  "Park plaza HOTEL": Object.fromEntries(
    ["Andrei Chira", "Benjamin Pool", "Giovanni Scozzaro", "Jamel Sarray", "Stephen Telg", "Younes Ben Mouhou"].map(
      (n) => [n, ["Park plaza HOTEL — Park Plaza Amsterdam Airoport"]],
    ),
  ),
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’`.]/g, "").replace(/\s+/g, " ").trim();

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "?";
  console.log(`host: ${host} · mode: ${EXECUTE ? "EXECUTE" : "dry-run"}`);
  if (EXECUTE && !host.includes("ep-icy-scene")) {
    console.error("REFUSING --execute: this data belongs on prod (ep-icy-scene) only.");
    process.exit(2);
  }

  const smChefs = JSON.parse(readFileSync(chefsPath!, "utf-8")) as SmChef[];
  const smKlanten = JSON.parse(readFileSync(klantenPath!, "utf-8")) as SmKlant[];

  /* ---------------- chefs ---------------- */
  const prodChefs = await db
    .select({ id: chefs.id, fullName: chefs.fullName, email: chefs.email, notes: chefs.notes })
    .from(chefs)
    .where(isNull(chefs.deletedAt));
  const byEmail = new Map<string, typeof prodChefs>();
  for (const c of prodChefs) {
    const k = (c.email ?? "").toLowerCase();
    if (!k) continue;
    byEmail.set(k, [...(byEmail.get(k) ?? []), c]);
  }
  const byName = new Map(prodChefs.map((c) => [norm(c.fullName), c]));

  let cUpdated = 0, cSkipped = 0, cMissed = 0;
  const missedChefs: string[] = [];
  for (const sm of smChefs) {
    const hasContent = (sm.notes?.length ?? 0) > 0 || (sm.stats && (sm.stats.invites > 0 || sm.stats.minutes > 0));
    if (!hasContent) continue;
    const candidates = byEmail.get((sm.email ?? "").toLowerCase()) ?? [];
    const target =
      candidates.length === 1 ? candidates[0]
      : candidates.length > 1 ? (candidates.find((c) => norm(c.fullName) === norm(sm.name)) ?? candidates[0])
      : byName.get(norm(sm.name));
    if (!target) { cMissed++; missedChefs.push(`${sm.name} <${sm.email}>`); continue; }
    if ((target.notes ?? "").includes(MARKER)) { cSkipped++; continue; }

    const lines: string[] = [HEADER];
    if (sm.stats && (sm.stats.invites > 0 || sm.stats.minutes > 0)) {
      const uren = Math.round(sm.stats.minutes / 60);
      let s = `Historie oud systeem: ${sm.stats.invites} uitnodigingen · ±${uren} uur gewerkt`;
      if (sm.stats.ratingCount > 0) s += ` · beoordeling ${sm.stats.rating}/10 (${sm.stats.ratingCount}×)`;
      lines.push(s);
    }
    for (const n of sm.notes ?? []) lines.push(`• ${n.date} (${n.by}): ${n.text}`);
    const block = lines.join("\n");

    if (EXECUTE) {
      await db
        .update(chefs)
        .set({ notes: target.notes ? `${target.notes}\n\n${block}` : block, updatedAt: new Date() })
        .where(eq(chefs.id, target.id));
    }
    cUpdated++;
  }

  /* ---------------- klanten ---------------- */
  const prodClients = await db
    .select({
      id: clients.id, companyName: clients.companyName, notes: clients.notes,
      paymentTermsDays: clients.paymentTermsDays, favoriteChefIds: clients.favoriteChefIds,
      blockedChefIds: clients.blockedChefIds, chefMustBring: clients.chefMustBring,
      parkingAvailable: clients.parkingAvailable,
    })
    .from(clients)
    .where(isNull(clients.deletedAt));
  const clientByName = new Map(prodClients.map((c) => [c.companyName, c]));
  const chefIdByName = new Map(prodChefs.map((c) => [norm(c.fullName), c.id]));

  let kUpdated = 0, kSkipped = 0, kMissed = 0, favLinked = 0, blockLinked = 0, favUnmatched = 0, blUnmatched = 0;
  const missedKlanten: string[] = [];
  for (const sm of smKlanten) {
    const targets = (MULTI_MAP[sm.name] ?? [sm.name]).map((n) => clientByName.get(n)).filter(Boolean) as typeof prodClients;
    if (!targets.length) { kMissed++; missedKlanten.push(sm.name); continue; }

    for (const target of targets) {
      if ((target.notes ?? "").includes(MARKER)) { kSkipped++; continue; }

      const lines: string[] = [HEADER];
      const vw: string[] = [];
      if (sm.paymentTerm !== null) vw.push(`betaaltermijn ${sm.paymentTerm} dgn`);
      if (sm.payrollPerc !== null && sm.payrollPerc > 0) vw.push(`payroll-opslag ${sm.payrollPerc}%`);
      if (sm.alg?.includes("contract ")) vw.push("getekend contract in oud systeem (pdf)");
      if (vw.length) lines.push(`Voorwaarden oud systeem: ${vw.join(" · ")}`);
      if (sm.vestigingen.length > 1 || MULTI_MAP[sm.name]) {
        lines.push(`Vestigingen (oud): ${sm.vestigingen.map((v) => `${v.naam} — ${v.straat} ${v.nummer}, ${v.postcode} ${v.plaats}`).join(" · ")}`);
      }
      if (sm.tarieven.length) lines.push(`Tarieven (oud): ${sm.tarieven.join(" · ")}`);
      for (const b of sm.briefings) lines.push(`Briefing (oud): ${b}`);
      if (sm.favorieten.length) lines.push(`Favorieten (oud): ${sm.favorieten.join(", ")}`);
      for (const b of sm.blacklist) lines.push(`Blacklist (oud): ${b.name}${b.reason ? ` — ${b.reason}` : ""}`);
      for (const c of sm.communicatie) lines.push(`• ${c}`);

      // relationship arrays — only names that exist as prod chefs; venue-scoped where known
      const scoped = VENUE_SCOPED_FAVS[sm.name];
      const favIds = new Set(target.favoriteChefIds ?? []);
      for (const name of sm.favorieten) {
        const id = chefIdByName.get(norm(name));
        if (!id) { favUnmatched++; continue; }
        if (scoped?.[name] && !scoped[name].includes(target.companyName)) continue;
        if (!favIds.has(id)) { favIds.add(id); favLinked++; }
      }
      const blockIds = new Set(target.blockedChefIds ?? []);
      for (const b of sm.blacklist) {
        const id = chefIdByName.get(norm(b.name));
        if (!id) { blUnmatched++; continue; }
        if (!blockIds.has(id)) { blockIds.add(id); blockLinked++; }
      }

      // conservative briefing-derived fields (fill-NULL-only)
      const briefingText = sm.briefings.join(" ").toLowerCase();
      const mustBring =
        (target.chefMustBring == null || target.chefMustBring.length === 0) &&
        /own (uniform|knives)|eigen (uniform|messen)|uniform\+knives|uniform and knives/.test(briefingText)
          ? ["Eigen uniform en messen (uit oud systeem)"]
          : undefined;
      let parking: boolean | undefined;
      if (target.parkingAvailable == null) {
        if (/free parking|parking is free|parking free|private parking is possible|kosteloos geparkeerd|parkeren.*kosteloos|private parking, validate/.test(briefingText)) parking = true;
        else if (/no private parking|not have private parking|don't have private parking|car is not possible|car isn't possible|going by car not possible|going by car is not possible/.test(briefingText)) parking = false;
      }

      if (EXECUTE) {
        await db
          .update(clients)
          .set({
            notes: target.notes ? `${target.notes}\n\n${lines.join("\n")}` : lines.join("\n"),
            // the column defaults to 14, so an untouched 14 is "not deliberately set" —
            // the old system's real term wins there; an owner-set other value is kept.
            paymentTermsDays:
              sm.paymentTerm && sm.paymentTerm > 0 && (target.paymentTermsDays == null || target.paymentTermsDays === 14)
                ? sm.paymentTerm
                : undefined,
            favoriteChefIds: favIds.size ? [...favIds] : target.favoriteChefIds,
            blockedChefIds: blockIds.size ? [...blockIds] : target.blockedChefIds,
            ...(mustBring !== undefined ? { chefMustBring: mustBring } : {}),
            ...(parking !== undefined ? { parkingAvailable: parking } : {}),
            updatedAt: new Date(),
          })
          .where(eq(clients.id, target.id));
      }
      kUpdated++;
    }
  }

  console.log(`\nchefs:   ${EXECUTE ? "updated" : "WOULD update"} ${cUpdated} · already done ${cSkipped} · no prod match ${cMissed}${missedChefs.length ? ` (${missedChefs.join("; ")})` : ""}`);
  console.log(`klanten: ${EXECUTE ? "updated" : "WOULD update"} ${kUpdated} · already done ${kSkipped} · no prod match ${kMissed}${missedKlanten.length ? ` (${missedKlanten.join("; ")})` : ""}`);
  console.log(`relaties: +${favLinked} favoriet-koppelingen · +${blockLinked} blacklist-koppelingen · ${favUnmatched} favorieten en ${blUnmatched} blacklist-namen zonder prod-chef (blijven als tekst in notes)`);

  if (EXECUTE && (cUpdated > 0 || kUpdated > 0)) {
    await recordAuditCore({
      userId: null as never,
      action: "profiles.import_knowledge",
      resource: "chefs+clients",
      resourceId: "shiftmanager-extract",
      after: { chefsUpdated: cUpdated, clientsUpdated: kUpdated, favLinked, blockLinked, source: "ShiftManager Pro (oud systeem), read-only extract 2026-07-27" },
    }).catch((e) => console.error("audit failed (import succeeded):", e));
  }
}

main().then(() => process.exit(0));
