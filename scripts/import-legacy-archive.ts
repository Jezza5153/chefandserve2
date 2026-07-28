/**
 * The operational archive of the OLD system → `legacy_ops_months` + `legacy_client_totals`.
 *
 *   scripts/with-prod-env.sh scripts/import-legacy-archive.ts \
 *     --months=~/Downloads/shiftmanager-extract/legacy-months.csv \
 *     --klanten=~/Downloads/shiftmanager-extract/legacy-klanten.csv [--execute]
 *
 * WHY. Every KPI here reads 0 — fill rate, seasonality, forecast — because our own
 * `shifts`/`placements` start empty, while the agency ran 30–40 diensten a day from 2022
 * on. This carries that curve over so the baselines have something real underneath them.
 *
 * SOURCE. The old system's Weekoverzicht (server-rendered, one page per week) states per
 * day: orders, slots filled/total, hours filled/total, and per klant the shifts. ~240 week
 * pages cover 2022 → now; the rollups land here.
 *
 * DELIBERATELY SEPARATE from `shifts`/`placements`: a legacy month is not a set of
 * placements, and mixing them would corrupt every operational query. Anything that wants
 * history reads the legacy tables explicitly and labels them.
 *
 * Klant matching goes through `besteMatch()` (src/lib/domain/legacy-match.ts), NOT through
 * string containment. Containment was tried first and matched on word order: it missed
 * "Renaissance Hotel Amsterdam" against our own "Renaissance Amsterdam Hotel", and dropped
 * "Showw B.V." for being too short — four klanten we already serve were then reported as
 * accounts still to migrate.
 *
 * Names that match nothing are KEPT with clientId = null. That means "no klant here under
 * this name" and NOTHING more: it is not evidence the klant is gone, because the old system
 * is still running and still booking. Reading null as "lost klant" is the exact mistake this
 * comment exists to prevent.
 *
 * Idempotent: months keyed on the month, klanten on the name; re-running updates.
 */
import { readFileSync } from "node:fs";

import { isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, legacyClientTotals, legacyOpsMonths } from "@/lib/db/schema";
import { besteMatch } from "@/lib/domain/legacy-match";
import { recordAuditCore } from "@/lib/audit";

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)?.replace(/^~/, process.env.HOME ?? "");
const monthsPath = arg("months");
const klantenPath = arg("klanten");
if (!monthsPath || !klantenPath) {
  console.error("Usage: --months=legacy-months.csv --klanten=legacy-klanten.csv [--execute]");
  process.exit(2);
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "?";
  console.log(`host: ${host} · mode: ${EXECUTE ? "EXECUTE" : "dry-run"}`);
  if (EXECUTE && !host.includes("ep-icy-scene")) {
    console.error("REFUSING --execute: hoort op prod (ep-icy-scene).");
    process.exit(2);
  }

  // maanden: YYYY-MM,orders,slotsGevuld,slotsTotaal,urenGevuld,urenTotaal
  const monthRows = new Map<string, { orders: number; sf: number; st: number; hf: number; ht: number }>();
  for (const line of readFileSync(monthsPath!, "utf-8").split("\n")) {
    const p = line.trim().split(",");
    if (p.length < 6 || !/^\d{4}-\d{2}$/.test(p[0])) continue;
    monthRows.set(`${p[0]}-01`, { orders: +p[1] || 0, sf: +p[2] || 0, st: +p[3] || 0, hf: +p[4] || 0, ht: +p[5] || 0 });
  }

  // klanten: naam;;diensten;;eersteMaand;;laatsteMaand
  //
  // The name is the conflict key, so punctuation that renders identically must not produce
  // two rows: the old system writes both "V'Leisure" and "V’Leisure" and that alone stored
  // one klant twice, double-counting 608 diensten.
  const nette = (naam: string) => naam.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, " ").trim();
  const klantRows: { name: string; shifts: number; first: string; last: string }[] = [];
  for (const line of readFileSync(klantenPath!, "utf-8").split("\n")) {
    const p = line.trim().split(";;");
    if (p.length < 4 || !p[0]) continue;
    klantRows.push({ name: nette(p[0]), shifts: Number(p[1]) || 0, first: p[2].trim(), last: p[3].trim() });
  }

  const known = await db.select({ id: clients.id, name: clients.companyName }).from(clients).where(isNull(clients.deletedAt));
  const kandidaten = known.map((c) => ({ waarde: c.id, naam: c.name }));
  const matchClient = (name: string): string | null => besteMatch(name, kandidaten);

  let matched = 0;
  let unmatched = 0;
  for (const r of klantRows) {
    if (matchClient(r.name)) matched++;
    else unmatched++;
  }

  if (EXECUTE) {
    for (const [month, v] of monthRows) {
      await db
        .insert(legacyOpsMonths)
        .values({ month, orders: v.orders, slotsFilled: v.sf, slotsTotal: v.st, hoursFilled: v.hf, hoursTotal: v.ht })
        .onConflictDoUpdate({
          target: legacyOpsMonths.month,
          set: { orders: v.orders, slotsFilled: v.sf, slotsTotal: v.st, hoursFilled: v.hf, hoursTotal: v.ht },
        });
    }
    for (const r of klantRows) {
      const cid = matchClient(r.name);
      await db
        .insert(legacyClientTotals)
        .values({ clientName: r.name, clientId: cid, shifts: r.shifts, firstMonth: r.first, lastMonth: r.last })
        .onConflictDoUpdate({
          target: legacyClientTotals.clientName,
          set: { shifts: r.shifts, firstMonth: r.first, lastMonth: r.last, clientId: cid },
        });
    }
  }

  const vals = [...monthRows.values()];
  const totOrders = vals.reduce((a, v) => a + v.orders, 0);
  const totHours = vals.reduce((a, v) => a + v.hf, 0);
  const slotsT = vals.reduce((a, v) => a + v.st, 0);
  const slotsF = vals.reduce((a, v) => a + v.sf, 0);
  const maanden = [...monthRows.keys()].sort();

  console.log(`\n${EXECUTE ? "geschreven" : "ZOU schrijven"}: ${monthRows.size} maanden · ${klantRows.length} klanten`);
  console.log(`  periode: ${maanden[0]?.slice(0, 7)} t/m ${maanden[maanden.length - 1]?.slice(0, 7)}`);
  console.log(
    `  totaal: ${totOrders.toLocaleString("nl-NL")} diensten · ${totHours.toLocaleString("nl-NL")} gewerkte uren · bezetting ${slotsT ? Math.round((slotsF / slotsT) * 100) : 0}%`,
  );
  console.log(`  klanten gekoppeld aan een klant hier: ${matched} · geen koppeling gevonden: ${unmatched} (bewaard; dat betekent NIET dat ze weg zijn)`);

  if (EXECUTE && monthRows.size > 0) {
    await recordAuditCore({
      userId: null as never,
      action: "ops.import_legacy_archive",
      resource: "legacy_ops_months",
      resourceId: "shiftmanager-weekoverzicht",
      after: { maanden: monthRows.size, klanten: klantRows.length, diensten: totOrders, uren: totHours },
    }).catch((e) => console.error("audit failed (import ok):", e));
  }
}

main().then(() => process.exit(0));
