/**
 * Smoke for the legacy operational archive: the reads AND the ops.history tool.
 *
 *   scripts/with-prod-env.sh scripts/smoke-legacy-ops.ts
 *
 * WHY a smoke and not just the eval: the CI eval only scores which tool the model PICKS, it
 * never executes one. `chefs.find` threw on every call for months and shipped green that way.
 * Everything here builds SQL, so it needs a run that actually touches Postgres.
 *
 * The classification asserts are the point. "Not in this system" was first read as "lost
 * klant", which produced the false headline that we had lost Hilton Schiphol — while that
 * venue simply re-registered under a shorter name and never stopped booking. These asserts
 * pin the four statuses apart so that mistake cannot come back silently.
 */
export {};

let ok = 0;
let bad = 0;
const check = (naam: string, voorwaarde: boolean, detail = "") => {
  if (voorwaarde) {
    ok++;
    console.log(`  ✓ ${naam}`);
  } else {
    bad++;
    console.log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`);
  }
};

async function main() {
  const { getLegacySummary, getLegacyMonths, getLegacySameMonth, getLegacyClientDemand, getLegacyRange } =
    await import("@/lib/domain/legacy-ops");
  const { opsHistory } = await import("@/lib/ai/tools/legacy-ops");

  console.log("\n— samenvatting —");
  const s = await getLegacySummary();
  if (!s) {
    console.log("  ⚠ archief is leeg in deze database — draai dit tegen prod");
    process.exit(0);
  }
  check("periode heeft begin en eind", !!s.van && !!s.tot, `${s.van}..${s.tot}`);
  check("diensten > 0", s.diensten > 0, String(s.diensten));
  check("uren > diensten (een dienst duurt >1 uur)", s.uren > s.diensten);
  check("bezetting is een percentage", s.bezettingPct != null && s.bezettingPct >= 0 && s.bezettingPct <= 100, String(s.bezettingPct));

  console.log("\n— per maand —");
  const maanden = await getLegacyMonths(12);
  check("levert maanden", maanden.length > 0, String(maanden.length));
  check("nieuwste eerst", maanden.length < 2 || maanden[0].month > maanden[1].month, maanden.slice(0, 2).map((m) => m.month).join(" > "));
  check("maandformaat YYYY-MM", maanden.every((m) => /^\d{4}-\d{2}$/.test(m.month)));
  check("som per maand ≤ totaal", maanden.reduce((a, m) => a + m.diensten, 0) <= s.diensten);

  console.log("\n— zelfde maand vorige jaren —");
  const juli = await getLegacySameMonth(7);
  check("juli komt in meerdere jaren voor", juli.length >= 2, String(juli.length));
  check("alle rijen zijn juli", juli.every((r) => r.month.endsWith("-07")), juli.map((r) => r.month).join(","));

  console.log("\n— klantstatus —");
  const klanten = await getLegacyClientDemand(200);
  check("levert klanten", klanten.length > 0, String(klanten.length));
  check("aflopend op diensten", klanten.length < 2 || klanten[0].diensten >= klanten[1].diensten);
  check(
    "klant met clientId heet in_dit_systeem",
    klanten.every((r) => (r.clientId != null) === (r.status === "in_dit_systeem")),
  );
  const recent = klanten.filter((r) => r.status === "nog_niet_overgezet");
  check(
    "nog_niet_overgezet boekt recent en heeft geen clientId",
    recent.every((r) => r.clientId == null && r.laatsteMaand >= "2026-01"),
    recent.map((r) => `${r.klant}:${r.laatsteMaand}`).join(" | ") || "geen",
  );
  const opgevolgd = klanten.filter((r) => r.status === "opgevolgd");
  check("opgevolgd noemt de opvolger", opgevolgd.every((r) => !!r.voortgezetAls));
  check(
    "opgevolgd verwijst nooit naar zichzelf",
    opgevolgd.every((r) => r.voortgezetAls !== r.klant),
  );
  const opvolgerNamen = new Set(klanten.filter((r) => r.status !== "weggevallen" && r.status !== "opgevolgd").map((r) => r.klant));
  check(
    "de opvolger is zelf niet weggevallen",
    opgevolgd.every((r) => opvolgerNamen.has(r.voortgezetAls!)),
    opgevolgd.map((r) => r.voortgezetAls).join(" | ") || "geen",
  );
  check(
    "een grote klant die onder nieuwe naam doorboekt telt NIET als verlies",
    !klanten.some((r) => r.status === "weggevallen" && /hilton/i.test(r.klant) && /schiphol/i.test(r.klant)),
    klanten.filter((r) => r.status === "weggevallen" && /hilton/i.test(r.klant)).map((r) => r.klant).join(" | "),
  );

  console.log("\n— bereik —");
  const bereik = await getLegacyRange("2024-01-01", "2024-12-31");
  check("2024 heeft diensten", bereik.diensten > 0, String(bereik.diensten));
  check("bereik ≤ totaal", bereik.diensten <= s.diensten);
  const leeg = await getLegacyRange("1999-01-01", "1999-12-31");
  check("leeg bereik geeft 0, niet null", leeg.diensten === 0 && leeg.bezettingPct == null);

  console.log("\n— ops.history tool —");
  for (const view of ["samenvatting", "per_maand", "zelfde_maand", "per_klant"] as const) {
    try {
      const res = await opsHistory.run({ view } as never, {} as never);
      check(`view ${view} draait en vat samen`, typeof res.summary === "string" && res.summary.length > 20, res.summary?.slice(0, 60));
    } catch (e) {
      check(`view ${view} draait`, false, String(e).slice(0, 120));
    }
  }
  const perKlant = await opsHistory.run({ view: "per_klant", limit: 20 } as never, {} as never);
  check(
    "per_klant waarschuwt tegen 'verloren' als er nog-niet-overgezette klanten zijn",
    recent.length === 0 || /GEEN verloren/.test(perKlant.summary ?? ""),
    perKlant.summary?.slice(0, 140),
  );

  console.log(`\n=== ${ok} passed, ${bad} failed ===`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
