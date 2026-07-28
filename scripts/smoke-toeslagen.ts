/**
 * Smoke for the surcharge engine (src/lib/surcharges.ts + domain/surcharges.ts).
 *
 *   scripts/with-prod-env.sh scripts/smoke-toeslagen.ts
 *
 * The timezone asserts are the reason this file exists. A surcharge window is a LOCAL
 * clock window while shifts are stored as instants, so doing the arithmetic in UTC shifts
 * every window by an hour for half the year — and on the October DST night a shift is 25
 * hours long, with two 02:00-03:00 hours that were both actually worked and must both be
 * paid. The "no rules = no money" assert protects the launch state: this ships empty and
 * must change nothing until finance fills it in.
 */
export {};

let ok = 0;
let bad = 0;
const check = (naam: string, voorwaarde: boolean, detail = "") => {
  if (voorwaarde) { ok++; console.log(`  ✓ ${naam}`); }
  else { bad++; console.log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
};

const regel = (o: Partial<Record<string, unknown>>) => ({
  id: "r", code: "test", label: "Test", kind: "time_window",
  startMinuteOfDay: 0, endMinuteOfDay: 360, weekdays: null, leadTimeHours: null,
  clientPctBps: 2500, chefPctBps: 2000, priority: 10, ...o,
}) as never;

async function main() {
  const { berekenToeslagen, lokaleSegmenten, nlFeestdagen, amsterdamDagSleutel } = await import("@/lib/surcharges");
  const { listSurchargeRules, heeftActieveToeslagen, valideerRegel } = await import("@/lib/domain/surcharges");

  console.log("\n— lokale tijd, niet UTC —");
  // 23:30 Amsterdam in de zomer = 21:30Z. Een UTC-berekening zou dit buiten 00:00-06:00 laten vallen én andersom.
  check("zomertijd: 21:30Z hoort bij de 24e lokaal", amsterdamDagSleutel(new Date("2026-07-24T21:30:00Z")) === "2026-07-24");
  // Winter is UTC+1: 22:30Z is nog de 24e (23:30 lokaal), 23:30Z is al de 25e (00:30 lokaal).
  check("wintertijd: 22:30Z hoort bij de 24e lokaal", amsterdamDagSleutel(new Date("2026-01-24T22:30:00Z")) === "2026-01-24");
  check("wintertijd: 23:30Z is al de 25e lokaal", amsterdamDagSleutel(new Date("2026-01-24T23:30:00Z")) === "2026-01-25");
  check("zomertijd: 22:30Z is al de 25e lokaal", amsterdamDagSleutel(new Date("2026-07-24T22:30:00Z")) === "2026-07-25");

  console.log("\n— DST-nachten —");
  const okt = lokaleSegmenten(new Date("2026-10-24T20:00:00Z"), new Date("2026-10-25T06:00:00Z"));
  check("oktobernacht splitst op lokale middernacht", okt.length === 2, okt.map((s) => s.dagSleutel).join(","));
  check("geen minuut zoek of dubbel",
    okt.reduce((s, x) => s + (x.totMs - x.vanMs), 0) === new Date("2026-10-25T06:00:00Z").getTime() - new Date("2026-10-24T20:00:00Z").getTime());
  const mrt = lokaleSegmenten(new Date("2026-03-28T20:00:00Z"), new Date("2026-03-29T06:00:00Z"));
  check("maartnacht (23 uur) splitst ook", mrt.length === 2, mrt.map((s) => s.dagSleutel).join(","));
  check("maartnacht verliest geen tijd",
    mrt.reduce((s, x) => s + (x.totMs - x.vanMs), 0) === new Date("2026-03-29T06:00:00Z").getTime() - new Date("2026-03-28T20:00:00Z").getTime());

  console.log("\n— bedragen —");
  const nacht = berekenToeslagen({
    van: new Date("2026-07-28T18:00:00Z"), tot: new Date("2026-07-29T02:00:00Z"), // 20:00-04:00 lokaal
    pauzeMinuten: 0, baseClientRateCents: 5000, baseChefRateCents: 3000, leadTimeHours: null,
    regels: [regel({})],
  });
  check("alleen de nachturen tellen (4 van 8)", nacht[0]?.minuten === 240, String(nacht[0]?.minuten));
  check("klantbedrag = 4u × €50 × 25% = €50,00", nacht[0]?.clientAmountCents === 5000, String(nacht[0]?.clientAmountCents));
  check("chefbedrag = 4u × €30 × 20% = €24,00", nacht[0]?.chefAmountCents === 2400, String(nacht[0]?.chefAmountCents));

  console.log("\n— prioriteit, geen stapeling —");
  const zondagNacht = berekenToeslagen({
    van: new Date("2026-08-01T22:00:00Z"), tot: new Date("2026-08-02T04:00:00Z"), // zondag 00:00-06:00 lokaal
    pauzeMinuten: 0, baseClientRateCents: 5000, baseChefRateCents: 3000, leadTimeHours: null,
    regels: [regel({}), regel({ id: "z", code: "zondag", label: "Zondag", kind: "weekday", weekdays: [7], startMinuteOfDay: null, endMinuteOfDay: null, priority: 20, clientPctBps: 5000, chefPctBps: 5000 })],
  });
  check("maar één regel wint per minuut", zondagNacht.length === 1, zondagNacht.map((x) => x.code).join(","));
  check("de hoogste prioriteit wint", zondagNacht[0]?.code === "zondag");
  check("niet gestapeld: 360 minuten, niet 720", zondagNacht[0]?.minuten === 360, String(zondagNacht[0]?.minuten));

  console.log("\n— venster over middernacht —");
  const wrap = berekenToeslagen({
    van: new Date("2026-07-28T19:00:00Z"), tot: new Date("2026-07-28T23:00:00Z"), // 21:00-01:00 lokaal
    pauzeMinuten: 0, baseClientRateCents: 5000, baseChefRateCents: 3000, leadTimeHours: null,
    regels: [regel({ startMinuteOfDay: 1320, endMinuteOfDay: 360 })], // 22:00-06:00
  });
  check("22:00-06:00 pakt zowel voor als na middernacht", wrap[0]?.minuten === 180, String(wrap[0]?.minuten));

  console.log("\n— pauze —");
  const metPauze = berekenToeslagen({
    van: new Date("2026-07-28T18:00:00Z"), tot: new Date("2026-07-29T02:00:00Z"),
    pauzeMinuten: 60, baseClientRateCents: 5000, baseChefRateCents: 3000, leadTimeHours: null,
    regels: [regel({})],
  });
  check("pauze verlaagt de toeslag evenredig", metPauze[0]!.minuten < 240 && metPauze[0]!.minuten > 200, String(metPauze[0]?.minuten));

  console.log("\n— feestdagen —");
  const f2026 = nlFeestdagen(2026);
  check("nieuwjaar", f2026.has("2026-01-01"));
  check("tweede paasdag 2026 = 6 april", f2026.has("2026-04-06"));
  check("hemelvaart 2026 = 14 mei", f2026.has("2026-05-14"));
  check("koningsdag", f2026.has("2026-04-27"));
  check("kerst", f2026.has("2026-12-25") && f2026.has("2026-12-26"));
  check("koningsdag schuift als 27 april op zondag valt", nlFeestdagen(2025).has("2025-04-26"), [...nlFeestdagen(2025)].filter((d) => d.startsWith("2025-04")).join(","));

  console.log("\n— leeg is echt leeg —");
  const geen = berekenToeslagen({
    van: new Date("2026-07-28T18:00:00Z"), tot: new Date("2026-07-29T02:00:00Z"),
    pauzeMinuten: 0, baseClientRateCents: 5000, baseChefRateCents: 3000, leadTimeHours: null, regels: [],
  });
  check("zonder regels wordt er niets berekend", geen.length === 0);
  const nulPct = berekenToeslagen({
    van: new Date("2026-07-28T18:00:00Z"), tot: new Date("2026-07-29T02:00:00Z"),
    pauzeMinuten: 0, baseClientRateCents: 5000, baseChefRateCents: 3000, leadTimeHours: null,
    regels: [regel({ clientPctBps: 0, chefPctBps: 0 })],
  });
  check("een regel van 0% levert geen regel op", nulPct.length === 0);

  console.log("\n— validatie van wat finance intypt —");
  const basis = { code: "x", label: "X", kind: "time_window" as const, startMinuteOfDay: 0, endMinuteOfDay: 360, weekdays: null, leadTimeHours: null, clientPctBps: 2500, chefPctBps: 2000, priority: 0, enabled: true };
  check("geldige regel wordt geaccepteerd", valideerRegel(basis).ok);
  check("gelijk begin en eind wordt geweigerd", !valideerRegel({ ...basis, endMinuteOfDay: 0 }).ok);
  check("negatieve toeslag wordt geweigerd", !valideerRegel({ ...basis, clientPctBps: -1 }).ok);
  check("meer dan 200% wordt geweigerd", !valideerRegel({ ...basis, clientPctBps: 25_000 }).ok);
  check("weekdagregel zonder dagen wordt geweigerd", !valideerRegel({ ...basis, kind: "weekday", weekdays: [] }).ok);
  check("spoedregel zonder uren wordt geweigerd", !valideerRegel({ ...basis, kind: "spoed", leadTimeHours: 0 }).ok);
  check("lege naam wordt geweigerd", !valideerRegel({ ...basis, label: "  " }).ok);

  console.log("\n— stand in deze database —");
  const regels = await listSurchargeRules();
  const actief = await heeftActieveToeslagen();
  console.log(`  (${regels.length} regels, actief: ${actief})`);
  check("de tabellen zijn leesbaar", Array.isArray(regels));
  check("zonder actieve regels meldt het systeem dat ook zo", regels.length > 0 || actief === false);

  console.log(`\n=== ${ok} passed, ${bad} failed ===`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
