/**
 * Smoke for the klant briefing (src/lib/domain/klant-briefing.ts).
 *
 *   scripts/with-prod-env.sh scripts/smoke-klant-briefing.ts
 *
 * The leak asserts are why this exists. The extractor reads the owner's internal notes —
 * which quote conflicts, name other klanten and record rates — and offers lines for
 * promotion to a CHEF-VISIBLE field. A rate that slips through is one click from a chef's
 * screen, so lines mentioning money, blacklists or conflicts must never be offered at all.
 */
export {};

let ok = 0;
let bad = 0;
const check = (naam: string, voorwaarde: boolean, detail = "") => {
  if (voorwaarde) { ok++; console.log(`  ✓ ${naam}`); }
  else { bad++; console.log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
};

async function main() {
  const { voorstellenUitNotities, briefingRegels, heeftBriefing, setKlantBriefingVeld, getKlantBriefing } =
    await import("@/lib/domain/klant-briefing");
  const { db } = await import("@/lib/db/client");
  const { clients } = await import("@/lib/db/schema");
  const { eq, isNull } = await import("drizzle-orm");

  console.log("\n— niets lekt naar de chef —");
  const gevaarlijk = [
    "• Parkeren kan gratis, tarief is 45 euro per uur voor deze klant",
    "• Kleding: zwarte broek. Let op: Jan staat op de blacklist na een conflict",
    "• Meenemen: eigen messen. Factuur gaat naar de holding",
    "• Parkeergarage onder het pand. Marge hier is dun.",
    "• Uniform verplicht — er lag een klacht over de vorige chef",
  ].join("\n");
  const uitGevaarlijk = voorstellenUitNotities(gevaarlijk);
  check("geen enkele regel met geld of conflict wordt aangeboden", uitGevaarlijk.length === 0,
    uitGevaarlijk.map((v) => v.regel.slice(0, 50)).join(" | "));

  console.log("\n— wat wél door mag —");
  const veilig = [
    "• 13 | 05/08/2022 | Parkeergarage onder het hotel, meld je bij de slagboom.",
    "• Kleding: zwarte broek, witte koksbuis en dichte schoenen.",
    "• Own knives are required for this location.",
    "• Personeelsingang aan de achterzijde, melden bij de receptie.",
  ].join("\n");
  const uitVeilig = voorstellenUitNotities(veilig);
  check("praktische regels komen er wel doorheen", uitVeilig.length >= 3, String(uitVeilig.length));
  check("het oude-systeem-prefix wordt gestript",
    uitVeilig.every((v) => !/^\d+\s*\|/.test(v.regel)),
    uitVeilig.map((v) => v.regel.slice(0, 30)).join(" | "));
  check("de datum wordt apart bewaard", uitVeilig.some((v) => v.datum === "05/08/2022"),
    uitVeilig.map((v) => v.datum).join(","));
  check("elke regel krijgt precies één veld",
    uitVeilig.length === new Set(uitVeilig.map((v) => v.regel)).size);

  console.log("\n— Engels telt ook —");
  const engels = voorstellenUitNotities("• Preferably white chef jacket (black ok). NO private parking; only OV covered.");
  check("een zin over een koksbuis valt onder kleding, niet parkeren",
    engels[0]?.veld === "dressCodeDefault", engels[0]?.veld ?? "geen");
  check("own knives valt onder meenemen",
    voorstellenUitNotities("• Own knives are required.")[0]?.veld === "bringAlong");

  console.log("\n— lege invoer —");
  check("geen notities = geen voorstellen", voorstellenUitNotities(null).length === 0);
  check("lege briefing telt als leeg", !heeftBriefing({ arrivalInstructions: null, parkingInfo: null, dressCodeDefault: null, bringAlong: null }));
  check("lege briefing levert geen regels", briefingRegels(null).length === 0);
  check("één veld ingevuld telt als gevuld",
    heeftBriefing({ arrivalInstructions: "achteringang", parkingInfo: null, dressCodeDefault: null, bringAlong: null }));

  console.log("\n— volgorde zoals je hem leest —");
  const regels = briefingRegels({
    arrivalInstructions: "achteringang", parkingInfo: "garage",
    dressCodeDefault: "witte buis", bringAlong: "messen",
  });
  check("vier regels", regels.length === 4);
  check("aankomst eerst, meenemen laatst",
    regels[0].label.includes("meld") && regels[3].label.includes("mee"),
    regels.map((r) => r.label).join(" → "));

  console.log("\n— opslaan en teruglezen —");
  const [klant] = (await db.select({ id: clients.id, arrival: clients.arrivalInstructions }).from(clients).where(isNull(clients.deletedAt)).limit(1)) as { id: string; arrival: string | null }[];
  if (klant) {
    const origineel = klant.arrival;
    await setKlantBriefingVeld(klant.id, "arrivalInstructions", "  SMOKE testingang  ");
    const na = await getKlantBriefing(klant.id);
    check("waarde is opgeslagen en getrimd", na?.arrivalInstructions === "SMOKE testingang", String(na?.arrivalInstructions));
    await setKlantBriefingVeld(klant.id, "arrivalInstructions", "   ");
    const leeg = await getKlantBriefing(klant.id);
    check("alleen spaties wordt NULL, niet een lege string", leeg?.arrivalInstructions === null, String(leeg?.arrivalInstructions));
    await db.update(clients).set({ arrivalInstructions: origineel }).where(eq(clients.id, klant.id));
    console.log("  (klant hersteld)");
  }

  console.log("\n— tegen de echte notities —");
  const alle = (await db.select({ notes: clients.notes }).from(clients).where(isNull(clients.deletedAt))) as { notes: string | null }[];
  const alleVoorstellen = alle.flatMap((r) => voorstellenUitNotities(r.notes));
  const verdacht = alleVoorstellen.filter((v) => /(tarief|€|blacklist|factuur|marge)/i.test(v.regel));
  check("geen enkel voorstel uit de echte data noemt geld of blacklist",
    verdacht.length === 0, verdacht.map((v) => v.regel.slice(0, 60)).join(" | "));
  console.log(`  (${alleVoorstellen.length} voorstellen over ${alle.length} klanten)`);

  console.log(`\n=== ${ok} passed, ${bad} failed ===`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
