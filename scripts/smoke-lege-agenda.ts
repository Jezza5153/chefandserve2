/**
 * Smoke for the empty-vs-done distinction (src/lib/lege-agenda.ts + the surfaces using it).
 *
 *   scripts/with-prod-env.sh scripts/smoke-lege-agenda.ts
 *
 * WHY: every forward-looking surface here was built while the work still lived in the old
 * system, so all of them learned to render zero as good news. The briefing said "Alle uren
 * van de afgelopen week zijn rond 👍" in a week with no shifts at all, and demand.forecast
 * said "de bezetting is rond 👍" over an empty agenda. These asserts pin the two apart.
 */
export {};

let ok = 0;
let bad = 0;
const check = (naam: string, voorwaarde: boolean, detail = "") => {
  if (voorwaarde) { ok++; console.log(`  ✓ ${naam}`); }
  else { bad++; console.log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
};

async function main() {
  const { bepaalStaat, legeAgendaZin, legeStaatLabel } = await import("@/lib/lege-agenda");
  const { buildDailyBriefing } = await import("@/lib/ai/read-model/briefing");
  const { demandForecast } = await import("@/lib/ai/tools/demand");
  const { buildDemandForecast } = await import("@/lib/ai/read-model/demand-forecast");

  console.log("\n— de drie staten —");
  check("niets aanwezig = leeg", bepaalStaat({ totaal: 0, open: 0 }) === "leeg");
  check("alles gedaan = afgerond", bepaalStaat({ totaal: 5, open: 0 }) === "afgerond");
  check("nog open = loopt", bepaalStaat({ totaal: 5, open: 2 }) === "loopt");
  check("leeg is NIET afgerond", bepaalStaat({ totaal: 0, open: 0 }) !== bepaalStaat({ totaal: 5, open: 0 }));
  check("elke staat heeft een eigen label",
    new Set(["leeg", "afgerond", "loopt"].map((s) => legeStaatLabel(s as never))).size === 3);

  console.log("\n— de zin —");
  const zin = legeAgendaZin("vandaag");
  check("noemt het een lege agenda", /lege agenda/i.test(zin), zin);
  check("ontkent expliciet dat het goede bezetting is", /geen goede bezetting/i.test(zin), zin);
  check("wijst naar het oude systeem", /oude systeem/i.test(zin), zin);
  check("bevat geen duimpje", !zin.includes("👍"), zin);
  check("verwijzing is uitzetbaar",
    !/oude systeem/i.test(legeAgendaZin("vandaag", { verwijsNaarArchief: false })));

  console.log("\n— vraagprognose —");
  const f = await buildDemandForecast(new Date(), 6);
  check("prognose telt geplande diensten", typeof f.totalShifts === "number", String(f.totalShifts));
  const res = await demandForecast.run({ weeks: 6 } as never, {} as never);
  if (f.totalShifts === 0) {
    check("lege agenda wordt NIET als goede bezetting gemeld", !/bezetting is rond/i.test(res.summary ?? ""), res.summary?.slice(0, 120));
    check("lege agenda wordt benoemd", /lege agenda/i.test(res.summary ?? ""), res.summary?.slice(0, 120));
    check("geen duimpje boven een leeg systeem", !(res.summary ?? "").includes("👍"), res.summary?.slice(0, 120));
  } else {
    check("met diensten erin noemt hij het aantal", /\d/.test(res.summary ?? ""), res.summary?.slice(0, 120));
  }

  console.log("\n— dagbriefing —");
  const b = await buildDailyBriefing(new Date());
  const tekst = typeof b === "string" ? b : JSON.stringify(b);
  check("briefing komt eruit", tekst.length > 40, String(tekst.length));
  const beweertRond = /uren van de afgelopen week zijn rond/i.test(tekst);
  const beweertLeeg = /geen diensten|lege agenda|niets in dit systeem/i.test(tekst);
  check(
    "claimt nooit tegelijk 'alles rond' en 'niets gepland'",
    !(beweertRond && beweertLeeg),
    tekst.slice(0, 200),
  );
  check("gebruikt nergens meer de kale zin 'Geen diensten gepland.'", !/Geen diensten gepland\./.test(tekst));
  check("gebruikt nergens meer 'Geen diensten gedraaid.'", !/Geen diensten gedraaid\./.test(tekst));

  console.log(`\n=== ${ok} passed, ${bad} failed ===`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
