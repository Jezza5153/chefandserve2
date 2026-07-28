/**
 * Smoke for invoice reminders (src/lib/domain/invoice-reminders.ts).
 *
 *   scripts/with-prod-env.sh scripts/smoke-aanmaningen.ts
 *
 * Sends nothing — it exercises the claim, which is the part that must be exactly right.
 * The claim is what makes a retried cron harmless: if it were a read-then-write, two runs
 * could both decide to send and a klant gets two demands for the same invoice on the same
 * morning. Everything else about this feature is recoverable; that is not.
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
  const { invoices, clients, users } = await import("@/lib/db/schema");
  const { eq, isNull } = await import("drizzle-orm");
  const {
    getAanmaningKandidaten, claimAanmaning, aanmaningToon, remindersEnabled,
    EERSTE_AANMANING_NA_DAGEN, HERHAAL_NA_DAGEN, MAX_AANMANINGEN,
  } = await import("@/lib/domain/invoice-reminders");

  console.log("\n— toon loopt op, herhaalt niet —");
  const t1 = aanmaningToon(1), t2 = aanmaningToon(2), t3 = aanmaningToon(3);
  check("eerste keer is vriendelijk", /ingeschoten/i.test(t1.opening), t1.opening.slice(0, 50));
  check("tweede keer is directer", t2.opening !== t1.opening);
  check("derde keer kondigt persoonlijk contact aan", /persoonlijk contact/i.test(t3.slot));
  check("elk onderwerp is anders",
    new Set([t1.onderwerp("X"), t2.onderwerp("X"), t3.onderwerp("X")]).size === 3);

  console.log("\n— drempels zijn zinnig —");
  check("niet dezelfde dag aanmanen", EERSTE_AANMANING_NA_DAGEN >= 1, String(EERSTE_AANMANING_NA_DAGEN));
  check("herhalen niet dagelijks", HERHAAL_NA_DAGEN >= 5, String(HERHAAL_NA_DAGEN));
  check("er is een plafond", MAX_AANMANINGEN >= 1 && MAX_AANMANINGEN <= 5, String(MAX_AANMANINGEN));

  console.log("\n— kandidaten —");
  const kandidaten = await getAanmaningKandidaten(new Date());
  check("levert een lijst", Array.isArray(kandidaten), String(kandidaten.length));
  check("iedereen op de lijst is echt te laat",
    kandidaten.every((k) => k.dagenTeLaat >= EERSTE_AANMANING_NA_DAGEN),
    kandidaten.map((k) => k.dagenTeLaat).join(","));
  check("wie het plafond raakt wordt gemarkeerd voor een mens",
    kandidaten.every((k) => k.handmatig === (k.eerdereAanmaningen >= MAX_AANMANINGEN)));
  console.log(`  (${kandidaten.length} kandidaten, ${kandidaten.filter((k) => k.handmatig).length} handmatig)`);

  console.log("\n— de claim, twee keer —");
  const [klant] = (await db.select({ id: clients.id, naam: clients.companyName }).from(clients).where(isNull(clients.deletedAt)).limit(1)) as { id: string; naam: string }[];
  const [gebruiker] = (await db.select({ id: users.id }).from(users).limit(1)) as { id: string }[];
  if (!klant || !gebruiker) { console.log("  ⚠ te weinig data"); process.exit(0); }

  const lang = new Date(Date.now() - 30 * 86_400_000);
  const [factuur] = await db.insert(invoices).values({
    number: `SMOKE-A-${Date.now()}`, clientId: klant.id, status: "sent", billToName: klant.naam,
    periodStart: lang, periodEnd: lang, issueDate: lang, dueDate: lang,
    totalCents: 12345, sentAt: lang, createdBy: gebruiker.id,
  }).returning({ id: invoices.id });

  try {
    const opLijst = await getAanmaningKandidaten(new Date());
    check("een 30 dagen te late factuur staat op de lijst", opLijst.some((k) => k.invoiceId === factuur.id));

    const eerste = await claimAanmaning(factuur.id);
    check("de eerste claim lukt", eerste);
    const tweede = await claimAanmaning(factuur.id);
    check("de tweede claim direct erna wordt geweigerd", !tweede, tweede ? "DUBBELE AANMANING!" : "");

    const [na] = await db.select({ n: invoices.reminderCount, at: invoices.lastReminderAt }).from(invoices).where(eq(invoices.id, factuur.id));
    check("teller staat op 1, niet op 2", na.n === 1, String(na.n));
    check("datum is gezet", !!na.at);

    const naClaim = await getAanmaningKandidaten(new Date());
    check("hij verdwijnt van de lijst tot het herhaalvenster om is",
      !naClaim.some((k) => k.invoiceId === factuur.id));

    // Plafond: zet de teller op het maximum en probeer opnieuw.
    await db.update(invoices).set({ reminderCount: MAX_AANMANINGEN, lastReminderAt: lang }).where(eq(invoices.id, factuur.id));
    const overPlafond = await claimAanmaning(factuur.id);
    check("boven het plafond claimt hij niet meer", !overPlafond);
    const lijstMetPlafond = await getAanmaningKandidaten(new Date());
    check("maar hij verschijnt wél als handmatig op te pakken",
      lijstMetPlafond.some((k) => k.invoiceId === factuur.id && k.handmatig));

    // Een betaalde factuur wordt nooit aangemaand.
    await db.update(invoices).set({ status: "paid", paidAt: new Date(), reminderCount: 0, lastReminderAt: null }).where(eq(invoices.id, factuur.id));
    const naBetaling = await getAanmaningKandidaten(new Date());
    check("een betaalde factuur staat niet op de lijst", !naBetaling.some((k) => k.invoiceId === factuur.id));
    check("en kan ook niet geclaimd worden", !(await claimAanmaning(factuur.id)));
  } finally {
    await db.delete(invoices).where(eq(invoices.id, factuur.id));
    console.log("\n(testfactuur opgeruimd)");
  }

  console.log(`\n(INVOICE_REMINDERS_ENABLED staat ${remindersEnabled() ? "AAN" : "UIT"})`);
  console.log(`\n=== ${ok} passed, ${bad} failed ===`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
