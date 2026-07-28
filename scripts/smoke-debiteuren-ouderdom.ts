/**
 * Smoke for receivables ageing (src/lib/domain/invoice-aging.ts + invoicing.open).
 *
 *   scripts/with-prod-env.sh scripts/smoke-debiteuren-ouderdom.ts
 *
 * The bucket boundaries are the point. An invoice due TODAY must not be chased: without
 * flooring both sides to a date it reads as "0.9 days late" by lunchtime and lands in the
 * 1-30 bucket, so a klant gets a reminder on the very day they were given to pay. The other
 * assert pins the bug this replaces — the page summed its outstanding total over the 100
 * rows it happened to display, so filtering to "paid" showed € 0 owed.
 */
export {};

let ok = 0;
let bad = 0;
const check = (naam: string, voorwaarde: boolean, detail = "") => {
  if (voorwaarde) { ok++; console.log(`  ✓ ${naam}`); }
  else { bad++; console.log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
};

async function main() {
  const { dagenTeLaat, bakVoor, getDebiteurenOuderdom, ouderdomSamenvatting, getOpenstaandTotaalCents } =
    await import("@/lib/domain/invoice-aging");
  const { invoicingOpen } = await import("@/lib/ai/tools/money");

  console.log("\n— dagen te laat —");
  const nu = new Date("2026-07-28T12:30:00Z");
  check("vandaag vervallen = 0 dagen, niet 1", dagenTeLaat("2026-07-28", nu) === 0, String(dagenTeLaat("2026-07-28", nu)));
  check("halverwege de dag telt niet als een dag", dagenTeLaat("2026-07-28", new Date("2026-07-28T23:30:00Z")) === 0);
  check("net na middernacht telt ook niet", dagenTeLaat("2026-07-28", new Date("2026-07-28T00:30:00Z")) === 0);
  check("gisteren vervallen = 1", dagenTeLaat("2026-07-27", nu) === 1, String(dagenTeLaat("2026-07-27", nu)));
  check("morgen vervallen = -1 (nog niet te laat)", dagenTeLaat("2026-07-29", nu) === -1);

  console.log("\n— bakgrenzen —");
  check("0 dagen = niet vervallen", bakVoor(0) === "niet_vervallen");
  check("-5 dagen = niet vervallen", bakVoor(-5) === "niet_vervallen");
  check("1 dag = 1-30", bakVoor(1) === "1-30");
  check("30 dagen = 1-30", bakVoor(30) === "1-30");
  check("31 dagen = 31-60", bakVoor(31) === "31-60");
  check("60 dagen = 31-60", bakVoor(60) === "31-60");
  check("61 dagen = 61-90", bakVoor(61) === "61-90");
  check("90 dagen = 61-90", bakVoor(90) === "61-90");
  check("91 dagen = 90+", bakVoor(91) === "90+");

  console.log("\n— tegen de database —");
  const o = await getDebiteurenOuderdom(new Date());
  check("vijf bakken, altijd allemaal aanwezig", o.bakken.length === 5, o.bakken.map((b) => b.bak).join(","));
  check("bakken tellen op tot het totaal", o.bakken.reduce((s, b) => s + b.cents, 0) === o.openCents);
  check("aantallen tellen op tot het totaal", o.bakken.reduce((s, b) => s + b.aantal, 0) === o.openAantal);
  check("te laat is nooit meer dan open", o.teLaatCents <= o.openCents && o.teLaatAantal <= o.openAantal);
  check("niets in de niet-vervallen bak is te laat",
    o.oudste.every((f) => f.dagenTeLaat > 0 && f.bak !== "niet_vervallen"));
  check("oudste staat vooraan", o.oudste.length < 2 || o.oudste[0].dagenTeLaat >= o.oudste[1].dagenTeLaat);
  const totaal = await getOpenstaandTotaalCents();
  check("losse totaal-query komt overeen", totaal === o.openCents, `${totaal} vs ${o.openCents}`);
  check("samenvatting is een echte zin", ouderdomSamenvatting(o).length > 15, ouderdomSamenvatting(o));

  console.log("\n— invoicing.open —");
  const res = await invoicingOpen.run({ limit: 5 } as never, {} as never);
  const d = res.data as { outstandingCents: number; ouderdom: unknown[]; invoices: unknown[] };
  check("tool draait", typeof res.summary === "string" && res.summary.length > 10, res.summary?.slice(0, 100));
  check(
    "totaal komt NIET uit de afgekapte lijst",
    d.outstandingCents === o.openCents,
    `tool ${d.outstandingCents} vs alles ${o.openCents} (lijst had ${d.invoices.length} rijen)`,
  );
  check("ouderdom zit in de payload", Array.isArray(d.ouderdom) && d.ouderdom.length === 5);

  console.log(`\n=== ${ok} passed, ${bad} failed ===`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
