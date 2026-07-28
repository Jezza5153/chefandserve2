/**
 * Mining round 3 — per-(chef, klant) work history from the old system.
 *
 *   scripts/with-prod-env.sh scripts/import-shiftmanager-pairs.ts \
 *     --file=~/Downloads/shiftmanager-extract/pairs.csv \
 *     --roster=~/Downloads/shiftmanager-extract/roster.txt \
 *     --klanten=~/Downloads/shiftmanager-extract/sm-klanten.json [--execute]
 *
 * WHY. "Die heeft daar al eens gestaan en het ging goed" is the strongest human signal a
 * planner has, and for the 204 migrated chefs it lived nowhere in this system (`placements`
 * starts empty). The old system tracks it per pair: uitnodigingen, gewerkte minuten and a
 * 1..10 rating. Lands in `chef_client_history` as clearly-labelled LEGACY data — never
 * merged into our own placements or our own 1..5 ratings.
 *
 * MULTI-VENUE CAVEAT (load-bearing, do not "simplify"). The old system counts per DEBITEUR;
 * we split two debiteuren into separate venue-clients at import (Baut ×4, Park Plaza ×2).
 * A debiteur total therefore describes the COMPANY, not one venue. We write the row for
 * every venue of that company — the "has worked here before" signal is true at company
 * level — but stamp `source = 'shiftmanager:debiteur'` so no surface can present the hours
 * as that venue's own. Single-venue klanten get `source = 'shiftmanager'`.
 *
 * Idempotent on (chefId, clientId): re-running updates the numbers, never duplicates.
 */
import { readFileSync } from "node:fs";

import { isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefClientHistory, chefs, clients } from "@/lib/db/schema";
import { recordAuditCore } from "@/lib/audit";

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)?.replace(/^~/, process.env.HOME ?? "");
const file = arg("file"), rosterPath = arg("roster"), klantenPath = arg("klanten");
if (!file || !rosterPath || !klantenPath) {
  console.error("Usage: --file=pairs.csv --roster=roster.txt --klanten=sm-klanten.json [--execute]");
  process.exit(2);
}

/** Old company name → the prod companyName(s) it became. Mirrors import-debiteuren.ts. */
const MULTI_MAP: Record<string, string[]> = {
  "Baut B.V.": ["Baut B.V. — Backstage", "Baut B.V. — Baut Carre", "Baut B.V. — Baut Zuid", "Baut B.V. — Feadship"],
  "Park plaza HOTEL": ["Park plaza HOTEL — Park Plaza Amsterdam Airoport", "Park plaza HOTEL — Park Plaza Vondelpark"],
  "Art Ventura": ["Art Ventura | Art Events b.v."],
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "?";
  console.log(`host: ${host} · mode: ${EXECUTE ? "EXECUTE" : "dry-run"}`);
  if (EXECUTE && !host.includes("ep-icy-scene")) {
    console.error("REFUSING --execute: hoort op prod (ep-icy-scene).");
    process.exit(2);
  }

  const emailByUid = new Map<string, string>();
  for (const line of readFileSync(rosterPath!, "utf-8").split("\n")) {
    const m = line.match(/^(\d+)\s+\S+\s+.+?\s+::\s+(\S+)$/);
    if (m) emailByUid.set(m[1], m[2].toLowerCase());
  }
  const nameByCid = new Map<string, string>();
  for (const k of JSON.parse(readFileSync(klantenPath!, "utf-8")) as { cid: string; name: string }[]) {
    nameByCid.set(k.cid, k.name);
  }

  const chefRows = await db.select({ id: chefs.id, email: chefs.email }).from(chefs).where(isNull(chefs.deletedAt));
  const chefByEmail = new Map(chefRows.filter((r) => r.email).map((r) => [r.email!.toLowerCase(), r.id]));
  const clientRows = await db.select({ id: clients.id, name: clients.companyName }).from(clients).where(isNull(clients.deletedAt));
  const clientByName = new Map(clientRows.map((r) => [r.name, r.id]));

  let written = 0, noChef = 0, noClient = 0, skippedEmpty = 0;
  const rowsToWrite: { chefId: string; clientId: string; invites: number; minutes: number; rating: number; ratingCount: number; multi: boolean }[] = [];

  for (const line of readFileSync(file!, "utf-8").split("\n")) {
    const p = line.trim().split(",");
    if (p.length < 6 || !/^\d+$/.test(p[0])) continue;
    const [uid, cid, invites, minutes, rating, ratingCount] = p;
    if (Number(invites) === 0 && Number(minutes) === 0) { skippedEmpty++; continue; }

    const chefId = chefByEmail.get(emailByUid.get(uid) ?? "");
    if (!chefId) { noChef++; continue; }

    const oldName = nameByCid.get(cid);
    const targets = (oldName ? (MULTI_MAP[oldName] ?? [oldName]) : []).map((n) => clientByName.get(n)).filter(Boolean) as string[];
    if (targets.length === 0) { noClient++; continue; }

    for (const clientId of targets) {
      rowsToWrite.push({
        chefId, clientId,
        invites: Number(invites) || 0,
        minutes: Number(minutes) || 0,
        rating: Number(rating) || 0,
        ratingCount: Number(ratingCount) || 0,
        multi: targets.length > 1,
      });
    }
  }

  if (EXECUTE) {
    for (const r of rowsToWrite) {
      await db
        .insert(chefClientHistory)
        .values({
          chefId: r.chefId, clientId: r.clientId,
          legacyInvites: r.invites, legacyMinutes: r.minutes,
          legacyRating: r.ratingCount > 0 ? String(r.rating) : null,
          legacyRatingCount: r.ratingCount,
          source: r.multi ? "shiftmanager:debiteur" : "shiftmanager",
        })
        .onConflictDoUpdate({
          target: [chefClientHistory.chefId, chefClientHistory.clientId],
          set: {
            legacyInvites: r.invites, legacyMinutes: r.minutes,
            legacyRating: r.ratingCount > 0 ? String(r.rating) : null,
            legacyRatingCount: r.ratingCount,
          },
        });
      written++;
    }
  } else {
    written = rowsToWrite.length;
  }

  const uniqueChefs = new Set(rowsToWrite.map((r) => r.chefId)).size;
  const hours = Math.round(rowsToWrite.reduce((a, r) => a + r.minutes, 0) / 60);
  console.log(`\n${EXECUTE ? "geschreven" : "ZOU schrijven"}: ${written} paar-rijen · ${uniqueChefs} chefs · ±${hours.toLocaleString("nl-NL")} uur historie`);
  console.log(`  lege paren overgeslagen: ${skippedEmpty} · geen prod-chef: ${noChef} · geen prod-klant: ${noClient}`);

  if (EXECUTE && written > 0) {
    await recordAuditCore({
      userId: null as never,
      action: "chefs.import_pair_history",
      resource: "chef_client_history",
      resourceId: "shiftmanager-pairs",
      after: { written, uniqueChefs, hours, source: "ShiftManager info_employee stats.client" },
    }).catch((e) => console.error("audit failed (import ok):", e));
  }
}

main().then(() => process.exit(0));
