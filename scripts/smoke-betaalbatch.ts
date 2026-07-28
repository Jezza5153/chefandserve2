/**
 * Smoke for payment batches (src/lib/sepa.ts + domain/betaalbatch.ts).
 *
 *   scripts/with-prod-env.sh scripts/smoke-betaalbatch.ts
 *
 * Creates its own chef invoice and batch and removes them again. No file is uploaded
 * anywhere; the SEPA XML only ever exists in memory here.
 *
 * The double-payment assert is the reason this file exists. Money that leaves twice does
 * not come back on its own, so the guard is a unique index rather than a check in code:
 * two people composing a batch at the same time must not both be able to include the same
 * invoice. The IBAN asserts matter for the same reason — a transposed pair of digits gives
 * a valid-looking account number that pays a stranger.
 */
export {};

let ok = 0;
let bad = 0;
const check = (naam: string, voorwaarde: boolean, detail = "") => {
  if (voorwaarde) { ok++; console.log(`  ✓ ${naam}`); }
  else { bad++; console.log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
};

async function main() {
  const { bouwSepaBestand, isGeldigIban, normaliseerIban, sepaTekst } = await import("@/lib/sepa");
  const { getTeBetalen, maakBetaalbatch, markeerBetaald } = await import("@/lib/domain/betaalbatch");
  const { db } = await import("@/lib/db/client");
  const { chefInvoices, chefs, users, betaalbatches, betaalbatchRegels } = await import("@/lib/db/schema");
  const { eq, isNull, isNotNull, and } = await import("drizzle-orm");

  console.log("\n— IBAN —");
  check("geldig NL IBAN", isGeldigIban("NL91 ABNA 0417 1643 00"));
  check("spaties maken niet uit", isGeldigIban("NL91ABNA0417164300"));
  check("omgewisselde cijfers worden gepakt", !isGeldigIban("NL91ABNA0417163400"));
  check("verkeerde controlecijfers", !isGeldigIban("NL92ABNA0417164300"));
  check("te kort", !isGeldigIban("NL91ABNA04"));
  check("leeg", !isGeldigIban(""));
  check("normaliseren", normaliseerIban(" nl91 abna 0417 1643 00 ") === "NL91ABNA0417164300");

  console.log("\n— SEPA-tekst —");
  check("accenten worden omgezet", sepaTekst("José Müller", 70) === "Jose Muller", sepaTekst("José Müller", 70));
  check("& wordt 'en' i.p.v. verdwijnen", sepaTekst("Chef & Serve", 70) === "Chef en Serve", sepaTekst("Chef & Serve", 70));
  check("lengte wordt afgekapt", sepaTekst("a".repeat(200), 70).length === 70);

  console.log("\n— bestand —");
  const goed = bouwSepaBestand({
    berichtId: "SMOKE-1", opdrachtgeverNaam: "Chef & Serve B.V.", opdrachtgeverIban: "NL91ABNA0417164300",
    uitvoerDatum: "2026-08-01", aangemaaktOp: new Date("2026-07-28T10:00:00Z"),
    betalingen: [
      { id: "a", naam: "Chef Een", iban: "NL91ABNA0417164300", bedragCents: 100_00, omschrijving: "Juli" },
      { id: "b", naam: "Chef Twee", iban: "NL91ABNA0417164300", bedragCents: 250_50, omschrijving: "Juli" },
    ],
  });
  check("bestand wordt gemaakt", goed.ok, goed.ok ? "" : goed.error);
  if (goed.ok) {
    check("controlesom klopt met de som van de regels", goed.xml.includes("<CtrlSum>350.50</CtrlSum>"));
    check("aantal transacties klopt", goed.xml.includes("<NbOfTxs>2</NbOfTxs>"));
    check("bedragen staan in euro's met twee decimalen", goed.xml.includes(">100.00<") && goed.xml.includes(">250.50<"));
    check("juiste schema-versie", goed.xml.includes("pain.001.001.03"));
    check("uitvoerdatum staat erin", goed.xml.includes("<ReqdExctnDt>2026-08-01</ReqdExctnDt>"));
  }
  const fout = bouwSepaBestand({
    berichtId: "SMOKE-2", opdrachtgeverNaam: "X", opdrachtgeverIban: "NL91ABNA0417164300",
    uitvoerDatum: "2026-08-01", aangemaaktOp: new Date(),
    betalingen: [{ id: "a", naam: "Fout", iban: "NL91ABNA0417163400", bedragCents: 100, omschrijving: "x" }],
  });
  check("een ongeldig IBAN blokkeert het hele bestand", !fout.ok, fout.ok ? "TOCH GEMAAKT" : fout.error.slice(0, 50));
  const nul = bouwSepaBestand({
    berichtId: "S", opdrachtgeverNaam: "X", opdrachtgeverIban: "NL91ABNA0417164300",
    uitvoerDatum: "2026-08-01", aangemaaktOp: new Date(),
    betalingen: [{ id: "a", naam: "Nul", iban: "NL91ABNA0417164300", bedragCents: 0, omschrijving: "x" }],
  });
  check("een bedrag van nul wordt geweigerd", !nul.ok);
  const leeg = bouwSepaBestand({
    berichtId: "S", opdrachtgeverNaam: "X", opdrachtgeverIban: "NL91ABNA0417164300",
    uitvoerDatum: "2026-08-01", aangemaaktOp: new Date(), betalingen: [],
  });
  check("een lege batch levert geen bestand", !leeg.ok);

  console.log("\n— tegen de database —");
  const [chef] = (await db.select({ id: chefs.id, naam: chefs.fullName })
    .from(chefs).where(and(isNull(chefs.deletedAt), isNotNull(chefs.ibanEncrypted))).limit(1)) as { id: string; naam: string }[];
  const [gebruiker] = (await db.select({ id: users.id }).from(users).limit(1)) as { id: string }[];
  if (!chef || !gebruiker) { console.log("  ⚠ geen chef met IBAN"); process.exit(0); }

  const [factuur] = await db.insert(chefInvoices).values({
    chefId: chef.id, status: "approved", amountCents: 4321,
    reference: "SMOKE-F1", periodFrom: "2026-07-01", periodTo: "2026-07-31",
  }).returning({ id: chefInvoices.id });

  let batchId: string | null = null;
  try {
    const open = await getTeBetalen();
    const mijne = open.find((t) => t.chefInvoiceId === factuur.id);
    check("een goedgekeurde onbetaalde factuur staat op de lijst", !!mijne);
    check("hij is betaalbaar (chef heeft een geldig IBAN)", mijne?.betaalbaar === true, mijne?.reden ?? "");

    const res = await maakBetaalbatch({ chefInvoiceIds: [factuur.id], uitvoerDatum: "2026-08-01", actorUserId: gebruiker.id });
    check("batch aangemaakt", res.ok, res.ok ? "" : res.error);
    if (!res.ok) throw new Error(res.error);
    batchId = res.batchId;
    check("het bedrag klopt", res.totaalCents === 4321, String(res.totaalCents));
    check("nummer heeft het juiste formaat", /^BET-\d{4}-\d{4}$/.test(res.nummer), res.nummer);

    const naBatch = await getTeBetalen();
    check("hij verdwijnt van de te-betalen lijst", !naBatch.some((t) => t.chefInvoiceId === factuur.id));

    // DE assert: dezelfde factuur nog een keer in een batch stoppen.
    const tweede = await maakBetaalbatch({ chefInvoiceIds: [factuur.id], uitvoerDatum: "2026-08-01", actorUserId: gebruiker.id });
    check("dezelfde factuur kan niet in een tweede batch", !tweede.ok, tweede.ok ? "DUBBEL BETAALD!" : tweede.error.slice(0, 70));

    console.log("\n— bestand maken is nog geen betaling —");
    const [voor] = await db.select({ status: chefInvoices.status, paid: chefInvoices.paidAt }).from(chefInvoices).where(eq(chefInvoices.id, factuur.id));
    check("de factuur staat nog niet op betaald", voor.paid === null && voor.status === "approved");

    const teVroeg = await markeerBetaald(batchId, gebruiker.id);
    check("een concept-batch kan niet op betaald", !teVroeg.ok, teVroeg.ok ? "TOCH" : teVroeg.error.slice(0, 60));

    await db.update(betaalbatches).set({ status: "generated", gegenereerdOp: new Date() }).where(eq(betaalbatches.id, batchId));
    const betaald = await markeerBetaald(batchId, gebruiker.id);
    check("na genereren kan hij wél op betaald", betaald.ok, betaald.ok ? "" : betaald.error);
    const [na] = await db.select({ status: chefInvoices.status, paid: chefInvoices.paidAt }).from(chefInvoices).where(eq(chefInvoices.id, factuur.id));
    check("nu pas is de factuur betaald", na.paid !== null && na.status === "paid", `${na.status}/${na.paid}`);

    const nogmaals = await markeerBetaald(batchId, gebruiker.id);
    check("twee keer op betaald zetten kan niet", !nogmaals.ok);
  } finally {
    if (batchId) {
      await db.delete(betaalbatchRegels).where(eq(betaalbatchRegels.batchId, batchId));
      await db.delete(betaalbatches).where(eq(betaalbatches.id, batchId));
    }
    await db.delete(chefInvoices).where(eq(chefInvoices.id, factuur.id));
    console.log("\n(opgeruimd)");
  }

  console.log(`\n=== ${ok} passed, ${bad} failed ===`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
