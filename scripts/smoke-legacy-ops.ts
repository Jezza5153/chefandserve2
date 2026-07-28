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
/** Are these two consecutive months (list runs newest first)? */
const maandenOverlapGeenGat = (nieuwer: string, ouder: string): boolean => {
  const nr = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
  return nr(nieuwer) - nr(ouder) === 1;
};

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
  check("archief draagt een datum van bijwerken", !!s.bijgewerkt, String(s.bijgewerkt));

  console.log("\n— per maand —");
  const maanden = await getLegacyMonths(12);
  check("levert maanden", maanden.length > 0, String(maanden.length));
  check("nieuwste eerst", maanden.length < 2 || maanden[0].month > maanden[1].month, maanden.slice(0, 2).map((m) => m.month).join(" > "));
  check("maandformaat YYYY-MM", maanden.every((m) => /^\d{4}-\d{2}$/.test(m.month)));
  check("elke maand weet of hij af is", maanden.every((m) => typeof m.afgerond === "boolean"));
  check("som per maand ≤ totaal", maanden.reduce((a, m) => a + m.diensten, 0) <= s.diensten);

  console.log("\n— zelfde maand vorige jaren —");
  const juli = await getLegacySameMonth(7);
  check("juli komt in meerdere jaren voor", juli.length >= 2, String(juli.length));
  check("het archief heeft geen stille gaten", maanden.every((m, i) => i === 0 || maandenOverlapGeenGat(maanden[i - 1].month, m.month)), maanden.map((m) => m.month).join(","));
  check("alle rijen zijn juli", juli.every((r) => r.month.endsWith("-07")), juli.map((r) => r.month).join(","));

  console.log("\n— klantstatus —");
  const { db } = await import("@/lib/db/client");
  const { clients } = await import("@/lib/db/schema");
  const { isNull } = await import("drizzle-orm");
  const { besteMatch } = await import("@/lib/domain/legacy-match");
  const huidige = (await db.select({ id: clients.id, naam: clients.companyName }).from(clients).where(isNull(clients.deletedAt))) as { id: string; naam: string }[];
  const kandidaten = huidige.map((c) => ({ waarde: c.naam, naam: c.naam }));

  const { klanten, totalen, teMigreren } = await getLegacyClientDemand(200);
  check("levert klanten", klanten.length > 0, String(klanten.length));
  check("aflopend op diensten", klanten.length < 2 || klanten[0].diensten >= klanten[1].diensten);
  check(
    "klant met clientId heet in_dit_systeem",
    klanten.every((r) => (r.clientId != null) === (r.status === "in_dit_systeem")),
  );

  // The defect this pins: four klanten we already serve were reported as "still to migrate"
  // because the name matcher tripped over word order. Anything on the migrate-list that in
  // fact resolves to a klant here is that same bug returning.
  const valsPositief = teMigreren.filter((r) => besteMatch(r.klant, kandidaten) != null);
  check(
    "geen klant op de overzet-lijst die we al hebben",
    valsPositief.length === 0,
    valsPositief.map((r) => `${r.klant} → ${besteMatch(r.klant, kandidaten)}`).join(" | "),
  );
  const valsVerlies = klanten
    .filter((r) => r.status === "weggevallen")
    .filter((r) => besteMatch(r.klant, kandidaten) != null);
  check(
    "geen huidige klant geteld als weggevallen",
    valsVerlies.length === 0,
    valsVerlies.map((r) => `${r.klant} → ${besteMatch(r.klant, kandidaten)}`).join(" | "),
  );

  check(
    "nog_niet_overgezet heeft geen clientId",
    teMigreren.every((r) => r.clientId == null),
  );
  const opgevolgd = klanten.filter((r) => r.status === "opgevolgd");
  check("opgevolgd noemt de opvolger", opgevolgd.every((r) => !!r.voortgezetAls));
  check("opgevolgd verwijst nooit naar zichzelf", opgevolgd.every((r) => r.voortgezetAls !== r.klant));
  const levendeNamen = new Set(klanten.filter((r) => r.status === "in_dit_systeem" || r.status === "nog_niet_overgezet").map((r) => r.klant));
  check(
    "de opvolger is zelf niet weggevallen",
    opgevolgd.every((r) => levendeNamen.has(r.voortgezetAls!)),
    opgevolgd.map((r) => r.voortgezetAls).join(" | ") || "geen",
  );
  check(
    "een grote klant die onder nieuwe naam doorboekt telt NIET als verlies",
    !klanten.some((r) => r.status === "weggevallen" && /hilton/i.test(r.klant) && /schiphol/i.test(r.klant)),
    klanten.filter((r) => r.status === "weggevallen" && /hilton/i.test(r.klant)).map((r) => r.klant).join(" | "),
  );

  // Venues of one chain ran side by side; calling one the successor of the other would erase
  // real losses. The periods are what tell a rename from a sibling.
  const { maandenOverlap } = await import("@/lib/domain/legacy-match");
  const parallel = opgevolgd.filter((r) => {
    const opv = klanten.find((k) => k.klant === r.voortgezetAls);
    return opv ? maandenOverlap(r.eersteMaand, r.laatsteMaand, opv.eersteMaand, opv.laatsteMaand) > 2 : false;
  });
  check("geen opvolger die jarenlang naast de oude regel liep", parallel.length === 0, parallel.map((r) => r.klant).join(" | "));

  check("totalen tellen op tot alle regels", Object.values(totalen).reduce((a, b) => a + b, 0) >= klanten.length);

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
  // At the default limit the migrate-list ranks below the slice, so this used to say nothing
  // at all and ended on the loss count. Call it exactly as the model would.
  const perKlant = await opsHistory.run({ view: "per_klant" } as never, {} as never);
  check(
    "per_klant noemt de overzet-lijst OOK op de standaardlimiet",
    teMigreren.length === 0 || /GEEN verloren/.test(perKlant.summary ?? ""),
    perKlant.summary?.slice(0, 200),
  );
  check(
    "per_klant telt over het hele archief, niet over de zichtbare top",
    new RegExp(`${totalen.weggevallen}`).test(perKlant.summary ?? ""),
    perKlant.summary?.slice(0, 200),
  );
  const perMaand = await opsHistory.run({ view: "per_maand" } as never, {} as never);
  check(
    "per_maand citeert een AFGERONDE maand, niet de lopende",
    /AFGERONDE/.test(perMaand.summary ?? ""),
    perMaand.summary?.slice(0, 160),
  );

  console.log(`\n=== ${ok} passed, ${bad} failed ===`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
