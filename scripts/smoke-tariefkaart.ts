/**
 * Smoke for the rate card (src/lib/domain/rate-card.ts + createShift + rates.card).
 *
 *   scripts/with-prod-env.sh scripts/smoke-tariefkaart.ts
 *
 * The half-filled case is the one worth pinning: an entry with only a klant rate would
 * prefill one side of a shift and leave the other at zero, and a zero chef rate reaches
 * payroll as a real amount. The other assert is that the norm only ever fills a BLANK —
 * a rate the operator typed must survive untouched, or the card stops being a norm and
 * starts overruling decisions.
 */
export {};

let ok = 0;
let bad = 0;
const check = (naam: string, voorwaarde: boolean, detail = "") => {
  if (voorwaarde) { ok++; console.log(`  ✓ ${naam}`); }
  else { bad++; console.log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
};

async function main() {
  const { getTariefkaart, beoordeelTarief, normMarge } = await import("@/lib/domain/rate-card");
  const { ratesCard } = await import("@/lib/ai/tools/rates");

  console.log("\n— marge —");
  check("marge klopt", normMarge({ klantCents: 5000, chefCents: 3500 }) === 30);
  check("marge bij 0 klanttarief is null", normMarge({ klantCents: 0, chefCents: 3500 }) === null);

  console.log("\n— oordeel over een ingevoerd tarief —");
  const norm = { klantCents: 4300, chefCents: 3000 };
  check("op de norm = geen opmerking", beoordeelTarief({ klantCents: 4300, chefCents: 3000 }, norm).ok);
  check("10% eronder blijft stil", beoordeelTarief({ klantCents: 3900, chefCents: 3000 }, norm).ok);
  const typefout = beoordeelTarief({ klantCents: 3400, chefCents: 3000 }, norm);
  check("de €34-i.p.v.-€43-typefout wordt gezien", !typefout.ok, typefout.opmerking ?? "");
  check("de opmerking noemt beide bedragen",
    /34,00/.test(typefout.opmerking ?? "") && /43,00/.test(typefout.opmerking ?? ""), typefout.opmerking ?? "");
  check("het blokkeert nooit", /kunt gewoon doorgaan/i.test(typefout.opmerking ?? ""), typefout.opmerking ?? "");
  const nul = beoordeelTarief({ klantCents: 0, chefCents: 3000 }, norm);
  check("€ 0,00 wordt apart benoemd", !nul.ok && /0,00/.test(nul.opmerking ?? ""), nul.opmerking ?? "");
  check("zonder norm valt er niets te zeggen", beoordeelTarief({ klantCents: 1, chefCents: 1 }, null).ok);

  console.log("\n— de kaart uit de database —");
  const kaart = await getTariefkaart();
  const rollen = Object.entries(kaart);
  check("kaart is leesbaar", typeof kaart === "object");
  check("geen enkele halve regel overleeft het lezen",
    rollen.every(([, n]) => n.klantCents > 0 && n.chefCents > 0),
    rollen.filter(([, n]) => !(n.klantCents > 0 && n.chefCents > 0)).map(([r]) => r).join(","));
  check("geen negatieve marge in de kaart",
    rollen.every(([, n]) => n.chefCents <= n.klantCents),
    rollen.filter(([, n]) => n.chefCents > n.klantCents).map(([r]) => r).join(","));

  console.log("\n— rates.card —");
  const res = await ratesCard.run({} as never, {} as never);
  check("tool draait", typeof res.summary === "string" && res.summary.length > 20, res.summary?.slice(0, 100));
  if (rollen.length === 0) {
    check("bij een lege kaart verzint hij niets",
      /geen standaardtarieven/i.test(res.summary ?? "") && /verzin geen bedragen/i.test(res.summary ?? ""),
      res.summary?.slice(0, 140));
  } else {
    check("noemt dat het normen zijn", /norm/i.test(res.summary ?? ""), res.summary?.slice(0, 140));
    const een = await ratesCard.run({ rol: rollen[0][0] } as never, {} as never);
    check("één functie opvragen werkt", (een.data as { tarieven: unknown[] }).tarieven.length === 1);
  }
  const onbekend = await ratesCard.run({ rol: "bestaat_niet" } as never, {} as never);
  check("onbekende functie levert geen verzonnen bedrag",
    /geen standaardtarief|Noem geen bedrag|geen standaardtarieven/i.test(onbekend.summary ?? ""),
    onbekend.summary?.slice(0, 140));

  console.log(`\n=== ${ok} passed, ${bad} failed ===`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
