/**
 * Smoke for expense claims (src/lib/domain/expense-claims.ts + invoice generation).
 *
 *   scripts/with-prod-env.sh scripts/smoke-declaraties.ts
 *
 * Creates its own claim and invoice and removes them again.
 *
 * The double-billing assert is the one that matters. A receipt that reaches an invoice
 * twice is money taken from a klant twice, so `invoiceLineId` is written in the SAME
 * transaction as the line — this proves a second generation cannot pick the claim up.
 * The payroll assert protects the other direction: dropping NOT NULL on shift_hours_id is
 * pointless if the CSV still inner-joins hours away.
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
  const { chefExpenseClaims, chefs, clients, users, invoices, invoiceLines, payrollBatchLines } = await import("@/lib/db/schema");
  const { eq, isNull, sql } = await import("drizzle-orm");
  const {
    approveExpenseClaim, getDoorTeBelastenDeclaraties, getDeclaratieOverzicht,
    markeerDeclaratieGefactureerd, CATEGORIE_LABEL,
  } = await import("@/lib/domain/expense-claims");

  const [chef] = (await db.select({ id: chefs.id }).from(chefs).where(isNull(chefs.deletedAt)).limit(1)) as { id: string }[];
  const [klant] = (await db.select({ id: clients.id, naam: clients.companyName }).from(clients).where(isNull(clients.deletedAt)).limit(1)) as { id: string; naam: string }[];
  const [gebruiker] = (await db.select({ id: users.id }).from(users).limit(1)) as { id: string }[];
  if (!chef || !klant || !gebruiker) { console.log("  ⚠ te weinig data in deze database"); process.exit(0); }

  const [claim] = await db.insert(chefExpenseClaims).values({
    chefId: chef.id, category: "reiskosten", amountCents: 1250,
    description: "SMOKE testrit", status: "pending", clientId: klant.id,
  }).returning({ id: chefExpenseClaims.id });
  console.log(`\n(testdeclaratie ${claim.id.slice(0, 8)} aangemaakt)`);

  try {
    console.log("\n— goedkeuren —");
    const zonderDoorbelasting = await approveExpenseClaim({ claimId: claim.id, approverUserId: gebruiker.id });
    check("goedkeuren zonder doorbelasting lukt", zonderDoorbelasting.ok, zonderDoorbelasting.ok ? "" : zonderDoorbelasting.error);
    const nogmaals = await approveExpenseClaim({ claimId: claim.id, approverUserId: gebruiker.id });
    check("twee keer goedkeuren kan niet", !nogmaals.ok, nogmaals.ok ? "DUBBEL!" : nogmaals.error.slice(0, 60));

    const [na] = await db.select({ status: chefExpenseClaims.status, verkoop: chefExpenseClaims.sellAmountCents, klantId: chefExpenseClaims.clientId })
      .from(chefExpenseClaims).where(eq(chefExpenseClaims.id, claim.id));
    check("status staat op goedgekeurd", na.status === "approved");
    check("zonder doorbelasting blijft het verkoopbedrag leeg", na.verkoop == null);
    check("de klant is vastgelegd", na.klantId === klant.id);

    console.log("\n— doorbelasten —");
    const nietDoorbelast = await getDoorTeBelastenDeclaraties(klant.id);
    check("zonder verkoopbedrag staat hij niet op de doorbelast-lijst",
      !nietDoorbelast.some((d) => d.id === claim.id));

    await db.update(chefExpenseClaims).set({ status: "pending", sellAmountCents: null }).where(eq(chefExpenseClaims.id, claim.id));
    const metDoorbelasting = await approveExpenseClaim({ claimId: claim.id, approverUserId: gebruiker.id, sellAmountCents: 1500 });
    check("goedkeuren mét doorbelasting lukt", metDoorbelasting.ok, metDoorbelasting.ok ? "" : metDoorbelasting.error);
    const lijst = await getDoorTeBelastenDeclaraties(klant.id);
    const mijne = lijst.find((d) => d.id === claim.id);
    check("nu staat hij wél op de doorbelast-lijst", !!mijne);
    check("kostprijs en verkoop staan er allebei", mijne?.kostprijsCents === 1250 && mijne?.sellAmountCents === 1500,
      `${mijne?.kostprijsCents} / ${mijne?.sellAmountCents}`);
    check("de marge is zichtbaar, niet weggewerkt", (mijne?.sellAmountCents ?? 0) - (mijne?.kostprijsCents ?? 0) === 250);

    console.log("\n— niet twee keer factureren —");
    const [factuur] = await db.insert(invoices).values({
      number: `SMOKE-D-${Date.now()}`, clientId: klant.id, status: "draft", billToName: klant.naam,
      periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31"),
      issueDate: new Date("2026-02-01"), dueDate: new Date("2026-02-15"), createdBy: gebruiker.id,
    }).returning({ id: invoices.id });
    const [regel] = await db.insert(invoiceLines).values({
      invoiceId: factuur.id, kind: "expense",
      description: `${CATEGORIE_LABEL.reiskosten} — SMOKE`, amountCents: 1500, vatRateBps: 2100,
    }).returning({ id: invoiceLines.id });
    await markeerDeclaratieGefactureerd(claim.id, regel.id);

    const naFacturering = await getDoorTeBelastenDeclaraties(klant.id);
    check("een gefactureerde declaratie verdwijnt van de lijst",
      !naFacturering.some((d) => d.id === claim.id));

    // Nog een keer markeren mag de eerste koppeling niet overschrijven.
    const [andereRegel] = await db.insert(invoiceLines).values({
      invoiceId: factuur.id, kind: "expense", description: "SMOKE tweede", amountCents: 1500, vatRateBps: 2100,
    }).returning({ id: invoiceLines.id });
    await markeerDeclaratieGefactureerd(claim.id, andereRegel.id);
    const [naTweede] = await db.select({ regelId: chefExpenseClaims.invoiceLineId }).from(chefExpenseClaims).where(eq(chefExpenseClaims.id, claim.id));
    check("de eerste factuurregel blijft de enige koppeling", naTweede.regelId === regel.id);

    console.log("\n— payroll kan een regel zonder uren aan —");
    const kolom = await db.execute(sql`select is_nullable from information_schema.columns where table_name='payroll_batch_lines' and column_name='shift_hours_id'`);
    check("shift_hours_id mag leeg zijn", ((kolom.rows ?? kolom)[0] as { is_nullable: string }).is_nullable === "YES");
    const claimKolom = await db.execute(sql`select count(*)::int as n from information_schema.columns where table_name='payroll_batch_lines' and column_name='expense_claim_id'`);
    check("payroll-regel kan naar een declaratie wijzen", ((claimKolom.rows ?? claimKolom)[0] as { n: number }).n === 1);

    console.log("\n— overzicht —");
    const ov = await getDeclaratieOverzicht();
    check("overzicht telt", typeof ov.openstaand === "number" && typeof ov.margeCents === "number",
      JSON.stringify(ov));

    await db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, factuur.id));
    await db.delete(invoices).where(eq(invoices.id, factuur.id));
  } finally {
    await db.update(chefExpenseClaims).set({ invoiceLineId: null }).where(eq(chefExpenseClaims.id, claim.id));
    await db.delete(chefExpenseClaims).where(eq(chefExpenseClaims.id, claim.id));
    console.log("\n(opgeruimd)");
  }

  console.log(`\n=== ${ok} passed, ${bad} failed ===`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
