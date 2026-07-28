/**
 * The operational archive from the old system → `legacy_ops_days` + `legacy_client_months`.
 *
 *   scripts/with-prod-env.sh scripts/import-legacy-archive.ts \
 *     --days=~/Downloads/shiftmanager-extract/legacy-days.csv \
 *     --months=~/Downloads/shiftmanager-extract/legacy-client-months.csv [--execute]
 *
 * WHY. Every KPI in this system currently reads 0 — fill rate, seasonality, forecast —
 * because `shifts`/`placements` start empty, while the agency has actually been running
 * 30–40 diensten a day since 2022. This carries that curve over so the baselines have
 * something real underneath them.
 *
 * SOURCE. The old system's Weekoverzicht is server-rendered per week and states, per day:
 * orders, slots filled/total and hours filled/total; and per klant per day, the shifts.
 * ~240 week-pages cover 2022-01 → now.
 *
 * DELIBERATELY SEPARATE from `shifts`/`placements`: a legacy day is not a placement, and
 * mixing them would corrupt every operational query (open shifts, hours to approve, the
 * dashboard). Anything that wants history reads the legacy tables explicitly.
 *
 * Klant matching: exact companyName first, then a normalised compare. Non-matching names
 * are KEPT with clientId = null — a klant we no longer serve is exactly what a
 * churn/"welke klant zijn we kwijt"-question needs.
 *
 * Idempotent: days keyed on the date, klant-months on (name, month); re-running updates.
 */
import { readFileSync } from "node:fs";

import { isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, legacyClientMonths, legacyOpsDays } from "@/lib/db/schema";
import { recordAuditCore } from "@/lib/audit";

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)?.replace(/^~/, process.env.HOME ?? "");
const daysPath = arg("days"), monthsPath = arg("months");
if (!daysPath || !monthsPath) {
  console.error("Usage: --days=legacy-days.csv --months=legacy-client-months.csv [--execute]");
  process.exit(2);
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(b\.?v\.?|n\.?v\.?|bv|nv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "?";
  console.log(`host: ${host} · mode: ${EXECUTE ? "EXECUTE" : "dry-run"}`);
  if (EXECUTE && !host.includes("ep-icy-scene")) {
    console.error("REFUSING --execute: hoort op prod (ep-icy-scene).");
    process.exit(2);
  }

  /* ---- days ---- */
  const dayRows = new Map<string, { orders: number; sf: number; st: number; hf: number; ht: number }>();
  for (const line of readFileSync(daysPath!, "utf-8").split("\n")) {
    const p = line.trim().split(",");
    if (p.length < 6 || !/^\d{4}-\d{2}-\d{2}$/.test(p[0])) continue;
    // A week page repeats neighbouring days; last write wins (identical values anyway).
    dayRows.set(p[0], { orders: +p[1] || 0, sf: +p[2] || 0, st: +p[3] || 0, hf: +p[4] || 0, ht: +p[5] || 0 });
  }

  /* ---- klant × month ---- */
  const monthRows: { name: string; month: string; shifts: number }[] = [];
  for (const line of readFileSync(monthsPath!, "utf-8").split("\n")) {
    const m = line.trim().match(/^(.+)\|(\d{4}-\d{2}),(\d+)$/);
    if (!m) continue;
    monthRows.push({ name: m[1].trim(), month: `${m[2]}-01`, shifts: Number(m[3]) });
  }

  const known = await db.select({ id: clients.id, name: clients.companyName }).from(clients).where(isNull(clients.deletedAt));
  const byExact = new Map(known.map((c) => [c.name, c.id]));
  const byNorm = new Map(known.map((c) => [norm(c.name), c.id]));
  const matchClient = (name: string) => byExact.get(name) ?? byNorm.get(norm(name)) ?? null;

  let matched = 0, unmatched = 0;
  const unmatchedNames = new Set<string>();
  for (const r of monthRows) {
    if (matchClient(r.name)) matched++;
    else { unmatched++; unmatchedNames.add(r.name); }
  }

  if (EXECUTE) {
    for (const [day, v] of dayRows) {
      await db
        .insert(legacyOpsDays)
        .values({ day, orders: v.orders, slotsFilled: v.sf, slotsTotal: v.st, hoursFilled: v.hf, hoursTotal: v.ht })
        .onConflictDoUpdate({
          target: legacyOpsDays.day,
          set: { orders: v.orders, slotsFilled: v.sf, slotsTotal: v.st, hoursFilled: v.hf, hoursTotal: v.ht },
        });
    }
    for (const r of monthRows) {
      await db
        .insert(legacyClientMonths)
        .values({ clientName: r.name, clientId: matchClient(r.name), month: r.month, shifts: r.shifts })
        .onConflictDoUpdate({
          target: [legacyClientMonths.clientName, legacyClientMonths.month],
          set: { shifts: r.shifts, clientId: matchClient(r.name) },
        });
    }
  }

  const totOrders = [...dayRows.values()].reduce((a, v) => a + v.orders, 0);
  const totHours = [...dayRows.values()].reduce((a, v) => a + v.hf, 0);
  const fill = [...dayRows.values()].reduce((a, v) => a + v.st, 0);
  const filled = [...dayRows.values()].reduce((a, v) => a + v.sf, 0);
  const dates = [...dayRows.keys()].sort();

  console.log(`\n${EXECUTE ? "geschreven" : "ZOU schrijven"}: ${dayRows.size} dagen · ${monthRows.length} klant-maanden`);
  console.log(`  periode: ${dates[0]} t/m ${dates[dates.length - 1]}`);
  console.log(`  totaal: ${totOrders.toLocaleString("nl-NL")} diensten · ${totHours.toLocaleString("nl-NL")} gewerkte uren · bezetting ${fill ? Math.round((filled / fill) * 100) : 0}%`);
  console.log(`  klanten gekoppeld: ${matched} rijen · niet gekoppeld: ${unmatched} rijen (${unmatchedNames.size} namen — klanten die we niet meer bedienen, bewust bewaard)`);

  if (EXECUTE && dayRows.size > 0) {
    await recordAuditCore({
      userId: null as never,
      action: "ops.import_legacy_archive",
      resource: "legacy_ops_days",
      resourceId: "shiftmanager-weekoverzicht",
      after: { dagen: dayRows.size, klantMaanden: monthRows.length, diensten: totOrders, uren: totHours },
    }).catch((e) => console.error("audit failed (import ok):", e));
  }
}

main().then(() => process.exit(0));
