/**
 * Smoke for the group message (src/lib/domain/bulk-message.ts).
 *
 *   scripts/with-prod-env.sh scripts/smoke-bulkbericht.ts
 *
 * Sends NOTHING. Every assert here is about the guards, because that is where the risk is:
 * a message to the wrong group cannot be recalled. The flag is checked first so that even
 * if this smoke were ever run somewhere careless, the send path refuses on its own.
 */
export {};

let ok = 0;
let bad = 0;
const check = (naam: string, voorwaarde: boolean, detail = "") => {
  if (voorwaarde) { ok++; console.log(`  ✓ ${naam}`); }
  else { bad++; console.log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
};

async function main() {
  const { previewBulkMessage, sendBulkMessage, bulkMessageEnabled, MAX_ONTVANGERS } =
    await import("@/lib/domain/bulk-message");

  console.log("\n— voorbeeld verstuurt niets —");
  const alle = await previewBulkMessage({ limit: MAX_ONTVANGERS + 1 });
  check("voorbeeld levert een groep", alle.gevonden >= 0, String(alle.gevonden));
  check("bereikbaar + onbereikbaar = gevonden",
    alle.ontvangers.length + alle.onbereikbaar.length === alle.gevonden,
    `${alle.ontvangers.length}+${alle.onbereikbaar.length} vs ${alle.gevonden}`);
  check("iedereen in de verzendlijst is ook echt bereikbaar",
    alle.ontvangers.every((o) => o.email || o.userId));
  check("niemand in de onbereikbaar-lijst heeft een kanaal",
    alle.onbereikbaar.every((o) => !o.email && !o.userId));
  console.log(`  (${alle.gevonden} chefs gevonden, ${alle.ontvangers.length} bereikbaar)`);

  const gefilterd = await previewBulkMessage({ vakniveau: "sous_chef", limit: MAX_ONTVANGERS + 1 });
  check("een filter maakt de groep kleiner of gelijk", gefilterd.gevonden <= alle.gevonden,
    `${gefilterd.gevonden} vs ${alle.gevonden}`);
  const onzin = await previewBulkMessage({ city: "Zzzzz-bestaat-niet", limit: 10 });
  check("een filter die niets raakt levert niemand", onzin.ontvangers.length === 0);

  console.log("\n— de poorten voor het versturen —");
  const uit = !bulkMessageEnabled();
  console.log(`  (BULK_MESSAGE_ENABLED staat ${uit ? "UIT" : "AAN"})`);

  const leeg = await sendBulkMessage({
    filter: { city: "Zzzzz-bestaat-niet" }, onderwerp: "Test", bericht: "Dit is een testbericht van voldoende lengte.",
    verwachtAantal: 0, actorUserId: "smoke",
  });
  check("een lege selectie verstuurt niets", !leeg.ok);

  const zonderOnderwerp = await sendBulkMessage({
    filter: {}, onderwerp: "  ", bericht: "Dit is een testbericht van voldoende lengte.",
    verwachtAantal: alle.ontvangers.length, actorUserId: "smoke",
  });
  check("zonder onderwerp verstuurt hij niets", !zonderOnderwerp.ok);

  const kort = await sendBulkMessage({
    filter: {}, onderwerp: "Test", bericht: "kort",
    verwachtAantal: alle.ontvangers.length, actorUserId: "smoke",
  });
  check("een bericht van vier tekens wordt geweigerd", !kort.ok);

  // De kernbescherming: het aantal moet exact zijn wat op het scherm stond.
  const verkeerdAantal = await sendBulkMessage({
    filter: {}, onderwerp: "Test", bericht: "Dit is een testbericht van voldoende lengte.",
    verwachtAantal: alle.ontvangers.length + 7, actorUserId: "smoke",
  });
  check(
    "een groep die niet klopt met het voorbeeld wordt geweigerd",
    !verkeerdAantal.ok,
    verkeerdAantal.ok ? "VERSTUURD!" : verkeerdAantal.error.slice(0, 90),
  );
  if (uit) {
    check("met de vlag uit is de reden altijd de vlag",
      !verkeerdAantal.ok && /staan uit/i.test(verkeerdAantal.error));
  }

  console.log("\n— het voorbeeld mag niet stilletjes afkappen —");
  // Dit ging in de eerste versie mis: findChefs kapt standaard op 25 af, dus het
  // voorbeeld toonde 25 namen terwijl het filter er 201 raakte. Je zou denken dat je
  // de hele groep bereikte.
  const { findChefs } = await import("@/lib/ai/read-model/directory");
  const zonderCap = await findChefs({ limit: MAX_ONTVANGERS + 1, maxLimit: MAX_ONTVANGERS + 1 });
  check(
    "voorbeeld toont evenveel als een ongekapte zoekopdracht",
    alle.gevonden === zonderCap.chefs.length,
    `${alle.gevonden} vs ${zonderCap.chefs.length}`,
  );
  check("en dat is meer dan de standaard-cap van 25", zonderCap.chefs.length > 25 ? alle.gevonden > 25 : true,
    String(alle.gevonden));

  console.log("\n— plafond —");
  check("het plafond is een echt getal", MAX_ONTVANGERS > 0 && MAX_ONTVANGERS <= 500, String(MAX_ONTVANGERS));
  check("voorbeeld markeert een te grote groep", typeof alle.teGroot === "boolean");

  console.log(`\n=== ${ok} passed, ${bad} failed ===`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
