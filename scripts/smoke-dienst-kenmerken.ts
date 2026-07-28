/**
 * Smoke for shift requirements (the nine columns that had no writers).
 *
 *   scripts/with-prod-env.sh scripts/smoke-dienst-kenmerken.ts
 *
 * Creates its own shift and removes it again.
 *
 * The columns existed from the start and NOTHING wrote them: no form, no template, no
 * tool. So every shift carried NULL and the two chef screens that render them always
 * showed nothing — a klant needing a French-speaking fine-dining chef had no way to say
 * so. These asserts prove each of the three write paths actually lands a value, and that
 * an update leaves alone what it was not asked to change.
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
  const { shifts, clients, users } = await import("@/lib/db/schema");
  const { eq, isNull } = await import("drizzle-orm");
  const { createShift, updateShift } = await import("@/lib/domain/shifts");

  const [klant] = (await db.select({ id: clients.id }).from(clients).where(isNull(clients.deletedAt)).limit(1)) as { id: string }[];
  const [gebruiker] = (await db.select({ id: users.id }).from(users).limit(1)) as { id: string }[];
  if (!klant || !gebruiker) { console.log("  ⚠ te weinig data"); process.exit(0); }

  const start = new Date(Date.now() + 30 * 86_400_000);
  const eind = new Date(start.getTime() + 6 * 3_600_000);

  console.log("\n— aanmaken mét kenmerken —");
  const res = await createShift({
    clientId: klant.id, startsAt: start, endsAt: eind, roleNeeded: "sous_chef",
    createdBy: gebruiker.id,
    dressCode: "zwart uniform, eigen messen",
    languageRequired: "Frans",
    minExperience: 5,
    kitchenType: "à la carte",
    soloOrTeam: "team",
    serviceStyle: "fine_dining",
    parkingAvailable: true,
    mealIncluded: true,
    startFlexible: false,
  });
  check("dienst aangemaakt", res.ok, res.ok ? "" : res.error);
  if (!res.ok) { console.log("=== afgebroken ==="); process.exit(1); }
  const shiftId = res.shiftId;

  try {
    const [rij] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    check("kledingeis is opgeslagen", rij.dressCode === "zwart uniform, eigen messen", String(rij.dressCode));
    check("taal is opgeslagen", rij.languageRequired === "Frans", String(rij.languageRequired));
    check("ervaring is opgeslagen", rij.minExperience === 5, String(rij.minExperience));
    check("keukentype is opgeslagen", rij.kitchenType === "à la carte", String(rij.kitchenType));
    check("solo/team is opgeslagen", rij.soloOrTeam === "team", String(rij.soloOrTeam));
    check("servicestijl is opgeslagen", rij.serviceStyle === "fine_dining", String(rij.serviceStyle));
    check("parkeren is opgeslagen", rij.parkingAvailable === true, String(rij.parkingAvailable));
    check("maaltijd is opgeslagen", rij.mealIncluded === true, String(rij.mealIncluded));
    check("false wordt bewaard als false, niet als leeg", rij.startFlexible === false, String(rij.startFlexible));

    console.log("\n— wijzigen raakt alleen wat je meestuurt —");
    const upd = await updateShift({ shiftId, editorUserId: gebruiker.id, languageRequired: "Engels" });
    check("wijziging lukt", upd.ok, upd.ok ? "" : upd.error);
    check("de taalwijziging staat in de wijzigingslijst",
      upd.ok && upd.changed.includes("taal"), upd.ok ? upd.changed.join(",") : "");
    const [na] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    check("taal is bijgewerkt", na.languageRequired === "Engels", String(na.languageRequired));
    check("kledingeis is NIET gewist", na.dressCode === "zwart uniform, eigen messen", String(na.dressCode));
    check("keukentype is NIET gewist", na.kitchenType === "à la carte", String(na.kitchenType));
    check("maaltijd is NIET gewist", na.mealIncluded === true, String(na.mealIncluded));

    console.log("\n— niets meesturen verandert niets —");
    const leeg = await updateShift({ shiftId, editorUserId: gebruiker.id });
    check("een lege wijziging meldt 'geen wijzigingen'", leeg.ok && leeg.changed.length === 0,
      leeg.ok ? leeg.changed.join(",") : "");

    console.log("\n— zonder kenmerken blijft alles leeg —");
    const kaal = await createShift({
      clientId: klant.id, startsAt: start, endsAt: eind, roleNeeded: "commis", createdBy: gebruiker.id,
    });
    if (kaal.ok) {
      const [k] = await db.select().from(shifts).where(eq(shifts.id, kaal.shiftId));
      check("geen eis betekent NULL, niet false",
        k.dressCode == null && k.parkingAvailable == null && k.mealIncluded == null,
        `${k.dressCode} / ${k.parkingAvailable} / ${k.mealIncluded}`);
      await db.delete(shifts).where(eq(shifts.id, kaal.shiftId));
    }
  } finally {
    await db.delete(shifts).where(eq(shifts.id, shiftId));
    console.log("\n(testdiensten opgeruimd)");
  }

  console.log(`\n=== ${ok} passed, ${bad} failed ===`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
