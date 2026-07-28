/**
 * Smoke for free invoice lines (src/lib/domain/invoice-lines.ts).
 *
 *   scripts/with-prod-env.sh scripts/smoke-factuurregels.ts
 *
 * Runs against a throwaway DRAFT invoice it creates and removes again — it never touches a
 * real one, because the whole point of the feature is that a sent invoice is frozen.
 *
 * Mixed VAT is the assert that matters most: € 100 at 21% plus € 100 at 9% must total
 * € 230,00, not € 234,00. Rounding the invoice total at one rate instead of summing the
 * lines is exactly the cent a klant's bookkeeper finds.
 */
export {};

let ok = 0;
let bad = 0;
const check = (naam: string, voorwaarde: boolean, detail = "") => {
  if (voorwaarde) { ok++; console.log(`  ✓ ${naam}`); }
  else { bad++; console.log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
};

async function main() {
  const { db } = await import("@/lib/db/client");
  const { invoices, invoiceLines, clients, users } = await import("@/lib/db/schema");
  const { eq, isNull } = await import("drizzle-orm");
  const { addInvoiceLine, deleteInvoiceLine, listInvoiceLines, recomputeInvoiceTotals } =
    await import("@/lib/domain/invoice-lines");

  const [klant] = (await db.select({ id: clients.id, naam: clients.companyName }).from(clients).where(isNull(clients.deletedAt)).limit(1)) as { id: string; naam: string }[];
  const [gebruiker] = (await db.select({ id: users.id }).from(users).limit(1)) as { id: string }[];
  if (!klant || !gebruiker) { console.log("  ⚠ geen klant of gebruiker in deze database"); process.exit(0); }

  const nummer = `SMOKE-${Date.now()}`;
  const [factuur] = await db
    .insert(invoices)
    .values({
      number: nummer, clientId: klant.id, status: "draft",
      billToName: klant.naam,
      periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31"),
      issueDate: new Date("2026-02-01"), dueDate: new Date("2026-02-15"),
      createdBy: gebruiker.id,
    })
    .returning({ id: invoices.id });
  console.log(`\n(testfactuur ${nummer} aangemaakt als concept)`);

  try {
    console.log("\n— regels toevoegen —");
    const a = await addInvoiceLine({ invoiceId: factuur.id, kind: "fee", description: "No-show 12 juli", amountCents: 10000, vatRateBps: 2100, userId: gebruiker.id });
    check("vergoeding toegevoegd", a.ok, a.ok ? "" : a.error);
    const b = await addInvoiceLine({ invoiceId: factuur.id, kind: "expense", description: "Maaltijden", amountCents: 10000, vatRateBps: 900, userId: gebruiker.id });
    check("doorbelaste kosten met 9% toegevoegd", b.ok, b.ok ? "" : b.error);

    const [na] = await db.select({ sub: invoices.subtotalCents, btw: invoices.vatCents, tot: invoices.totalCents }).from(invoices).where(eq(invoices.id, factuur.id));
    check("subtotaal telt op", na.sub === 20000, String(na.sub));
    check("BTW is per regel gerekend: 2100 + 900 = 3000", na.btw === 3000, `${na.btw} (fout zou 4200 zijn bij één tarief)`);
    check("totaal = 23000, niet 24200", na.tot === 23000, String(na.tot));

    console.log("\n— wat NIET mag —");
    const neg = await addInvoiceLine({ invoiceId: factuur.id, kind: "fee", description: "Fout", amountCents: -500, vatRateBps: 2100, userId: gebruiker.id });
    check("negatief bedrag mag alleen als korting", !neg.ok && /korting/i.test(neg.ok ? "" : neg.error));
    const posKorting = await addInvoiceLine({ invoiceId: factuur.id, kind: "discount", description: "Fout", amountCents: 500, vatRateBps: 2100, userId: gebruiker.id });
    check("korting moet negatief zijn", !posKorting.ok);
    const nul = await addInvoiceLine({ invoiceId: factuur.id, kind: "fee", description: "Fout", amountCents: 0, vatRateBps: 2100, userId: gebruiker.id });
    check("bedrag nul wordt geweigerd", !nul.ok);
    const leeg = await addInvoiceLine({ invoiceId: factuur.id, kind: "fee", description: "   ", amountCents: 100, vatRateBps: 2100, userId: gebruiker.id });
    check("lege omschrijving wordt geweigerd", !leeg.ok);
    const raarBtw = await addInvoiceLine({ invoiceId: factuur.id, kind: "fee", description: "Fout", amountCents: 100, vatRateBps: 1337, userId: gebruiker.id });
    check("onbekend BTW-tarief wordt geweigerd", !raarBtw.ok);

    console.log("\n— korting —");
    const k = await addInvoiceLine({ invoiceId: factuur.id, kind: "discount", description: "Coulance", amountCents: -5000, vatRateBps: 2100, userId: gebruiker.id });
    check("korting toegevoegd", k.ok, k.ok ? "" : k.error);
    const [naK] = await db.select({ sub: invoices.subtotalCents, tot: invoices.totalCents }).from(invoices).where(eq(invoices.id, factuur.id));
    check("korting verlaagt het subtotaal", naK.sub === 15000, String(naK.sub));

    console.log("\n— lijst —");
    const regels = await listInvoiceLines(factuur.id);
    check("drie regels", regels.length === 3, String(regels.length));
    check("alle drie handmatig gemarkeerd", regels.every((r) => r.handmatig));
    check("elke regel draagt een leesbaar soortlabel", regels.every((r) => r.soortLabel.length > 3));

    console.log("\n— een verstuurde factuur is bevroren —");
    await db.update(invoices).set({ status: "sent", sentAt: new Date() }).where(eq(invoices.id, factuur.id));
    const naSturen = await addInvoiceLine({ invoiceId: factuur.id, kind: "fee", description: "Te laat", amountCents: 100, vatRateBps: 2100, userId: gebruiker.id });
    check("toevoegen kan niet meer", !naSturen.ok && /verstuurd/i.test(naSturen.ok ? "" : naSturen.error));
    const weg = await deleteInvoiceLine({ lineId: regels[0].id, userId: gebruiker.id });
    check("verwijderen kan niet meer", !weg.ok);
    const herbereken = await recomputeInvoiceTotals(factuur.id);
    check("hertellen raakt een verstuurde factuur niet aan", !herbereken.ok);

    console.log("\n— urenregel is beschermd —");
    await db.update(invoices).set({ status: "draft", sentAt: null }).where(eq(invoices.id, factuur.id));
    const [urenRegel] = await db.insert(invoiceLines).values({
      invoiceId: factuur.id, kind: "hours", description: "Gewerkte uren", amountCents: 5000, vatRateBps: 2100,
    }).returning({ id: invoiceLines.id });
    const wegUren = await deleteInvoiceLine({ lineId: urenRegel.id, userId: gebruiker.id });
    check("een urenregel kun je hier niet weghalen", !wegUren.ok && /urenregistratie/i.test(wegUren.ok ? "" : wegUren.error));
    const wegHand = await deleteInvoiceLine({ lineId: regels[0].id, userId: gebruiker.id });
    check("een handmatige regel wél", wegHand.ok, wegHand.ok ? "" : wegHand.error);
  } finally {
    await db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, factuur.id));
    await db.delete(invoices).where(eq(invoices.id, factuur.id));
    console.log("\n(testfactuur opgeruimd)");
  }

  console.log(`\n=== ${ok} passed, ${bad} failed ===`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
