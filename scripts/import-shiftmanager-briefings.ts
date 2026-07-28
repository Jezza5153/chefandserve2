/**
 * Mining round 3 — the FULL klant briefings into the fields the chef-brief renders.
 *
 *   scripts/with-prod-env.sh scripts/import-shiftmanager-briefings.ts \
 *     --file=~/Downloads/shiftmanager-extract/briefings.txt \
 *     --klanten=~/Downloads/shiftmanager-extract/sm-klanten.json [--execute]
 *
 * Round 1 captured briefings only as a TRUNCATED line inside clients.notes (250 chars),
 * which cut exactly the operational half — the parking address, the km-rate, who to ask
 * for at reception. This carries the full text and, more importantly, splits it into the
 * structured fields the chef actually sees before a shift:
 *
 * - `shiftArrivalNotes` ← waar meld je je, parkeren, vervoersvergoeding
 * - `chefMustBring`     ← eigen uniform/messen/paspoort (array)
 *
 * Both are fill-when-empty; the full text is appended to clients.notes only when that
 * klant's block does not already contain it. Idempotent.
 *
 * Extraction is deliberately CONSERVATIVE: sentences are matched on unambiguous markers
 * (parkeren/parking/OV/km/reception/uniform/knives/passport) and copied VERBATIM. No
 * paraphrasing — a brief that invents a rule is worse than no brief.
 */
import { readFileSync } from "node:fs";

import { eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients } from "@/lib/db/schema";
import { recordAuditCore } from "@/lib/audit";

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)?.replace(/^~/, process.env.HOME ?? "");
const file = arg("file"), klantenPath = arg("klanten");
if (!file || !klantenPath) {
  console.error("Usage: --file=briefings.txt --klanten=sm-klanten.json [--execute]");
  process.exit(2);
}

const MULTI_MAP: Record<string, string[]> = {
  "Baut B.V.": ["Baut B.V. — Backstage", "Baut B.V. — Baut Carre", "Baut B.V. — Baut Zuid", "Baut B.V. — Feadship"],
  "Park plaza HOTEL": ["Park plaza HOTEL — Park Plaza Amsterdam Airoport", "Park plaza HOTEL — Park Plaza Vondelpark"],
  "Art Ventura": ["Art Ventura | Art Events b.v."],
};

/** Sentences about getting there / getting paid for getting there. */
const ARRIVAL_RE = /(park|parkeren|parking|garage|reception|receptie|meld|OV\b|public transport|openbaar vervoer|km are covered|0,2\d euro|station|bus)/i;
/** Sentences about what to carry. */
const BRING_RE = /(bring your own|own uniform|own knives|eigen (uniform|messen)|chef jacket|safety shoes|passport|paspoort|ID or Passport)/i;

const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "?";
  console.log(`host: ${host} · mode: ${EXECUTE ? "EXECUTE" : "dry-run"}`);
  if (EXECUTE && !host.includes("ep-icy-scene")) {
    console.error("REFUSING --execute: hoort op prod (ep-icy-scene).");
    process.exit(2);
  }

  const nameByCid = new Map<string, string>();
  for (const k of JSON.parse(readFileSync(klantenPath!, "utf-8")) as { cid: string; name: string }[]) nameByCid.set(k.cid, k.name);

  // cid → all briefing texts joined
  const byCid = new Map<string, string[]>();
  for (const line of readFileSync(file!, "utf-8").split("\n")) {
    const m = line.match(/^(\d+)\s*;;\s*(.+)$/);
    if (!m) continue;
    const text = m[2].includes(" | ") ? m[2].slice(m[2].indexOf(" | ") + 3) : m[2];
    byCid.set(m[1], [...(byCid.get(m[1]) ?? []), text.trim()]);
  }

  const rows = await db
    .select({
      id: clients.id, name: clients.companyName, notes: clients.notes,
      arrival: clients.shiftArrivalNotes, mustBring: clients.chefMustBring,
    })
    .from(clients)
    .where(isNull(clients.deletedAt));
  const byName = new Map(rows.map((r) => [r.name, r]));

  let filledArrival = 0, filledBring = 0, notesAppended = 0, noClient = 0;

  for (const [cid, texts] of byCid) {
    const oldName = nameByCid.get(cid);
    const targets = (oldName ? (MULTI_MAP[oldName] ?? [oldName]) : []).map((n) => byName.get(n)).filter(Boolean) as typeof rows;
    if (targets.length === 0) { noClient++; continue; }

    const all = texts.join(" ");
    const arrival = [...new Set(sentences(all).filter((s) => ARRIVAL_RE.test(s)))].join(" ");
    const bring = [...new Set(sentences(all).filter((s) => BRING_RE.test(s)))];

    for (const t of targets) {
      const set: Record<string, unknown> = {};
      if (arrival && !t.arrival) { set.shiftArrivalNotes = arrival.slice(0, 1200); filledArrival++; }
      if (bring.length && (t.mustBring ?? []).length === 0) { set.chefMustBring = bring.slice(0, 6).map((s) => s.slice(0, 200)); filledBring++; }

      // Full briefing into notes (round 1 stored a truncated version) — appended once.
      const marker = "Briefing (volledig, oud systeem)";
      if (!(t.notes ?? "").includes(marker)) {
        set.notes = `${t.notes ?? ""}\n\n${marker}:\n${texts.map((x) => `• ${x}`).join("\n")}`.trim();
        notesAppended++;
      }
      if (Object.keys(set).length === 0) continue;
      if (EXECUTE) await db.update(clients).set({ ...set, updatedAt: new Date() }).where(eq(clients.id, t.id));
    }
  }

  console.log(`\n${EXECUTE ? "bijgewerkt" : "ZOU bijwerken"}: aankomst-instructies +${filledArrival} · meenemen-lijst +${filledBring} · volledige briefing in notes +${notesAppended}`);
  console.log(`  geen prod-klant gevonden: ${noClient}`);

  if (EXECUTE && (filledArrival || filledBring || notesAppended)) {
    await recordAuditCore({
      userId: null as never,
      action: "clients.import_briefings",
      resource: "clients",
      resourceId: "shiftmanager-briefings",
      after: { filledArrival, filledBring, notesAppended, source: "ShiftManager customer_briefing (volledig)" },
    }).catch((e) => console.error("audit failed (import ok):", e));
  }
}

main().then(() => process.exit(0));
