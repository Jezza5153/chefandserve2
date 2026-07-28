/**
 * Betaalbatches — de agency betaalt haar chefs zelf.
 *
 * Payingit was de partij die uitbetaalde: dit systeem schreef een CSV en hoorde daarna
 * nooit meer iets, waardoor "betaald" een afgeleide was van onze eigen export in plaats
 * van een feit. Nu het bureau het zelf doet, hoort betalen een stap ín dit systeem te zijn.
 *
 * DE GRENS TEGEN DUBBEL BETALEN IS EEN UNIEKE INDEX, geen check in code. Precies één
 * batchregel per chef-factuur, afgedwongen door de database: twee mensen die tegelijk een
 * batch samenstellen kunnen dan niet allebei dezelfde factuur meenemen. Een controle in
 * TypeScript zou dat wél toelaten, en geld dat twee keer weggaat komt niet vanzelf terug.
 *
 * DRIE STAPPEN, ELK MET EEN MENS ERTUSSEN. Samenstellen → bestand genereren → bevestigen
 * dat de bank het heeft uitgevoerd. Het systeem praat niet met de bank; iemand downloadt
 * het bestand en uploadt het. Voor een betaalrun is dat de juiste hoeveelheid wrijving.
 *
 * IBAN's worden versleuteld opgeslagen én versleuteld in de batchregel gekopieerd: een
 * chef die later zijn rekeningnummer wijzigt mag niet met terugwerkende kracht veranderen
 * naar wie de betaling van vorige maand ging.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { betaalbatchRegels, betaalbatches, chefInvoices, chefs } from "@/lib/db/schema";
import { decryptPii } from "@/lib/crypto";
import { recordAuditFromRequest } from "@/lib/audit";
import { bouwSepaBestand, isGeldigIban, type SepaBetaling } from "@/lib/sepa";
import { getMoneyAssumptions } from "@/lib/business-settings";

export type TeBetalen = {
  chefInvoiceId: string;
  chefId: string;
  chefNaam: string;
  bedragCents: number;
  referentie: string | null;
  periode: string | null;
  /** False when we cannot pay this chef: no IBAN, or one that fails its check digits. */
  betaalbaar: boolean;
  reden: string | null;
};

/**
 * Approved chef invoices that are not paid and not already in a batch.
 *
 * Deliberately driven by `chef_invoices` — the ZZP direction that already exists — and not
 * by hours. An hour becomes money the chef may invoice; the invoice is what we owe. Paying
 * straight off hours would pay a chef who has not billed us yet.
 */
export async function getTeBetalen(): Promise<TeBetalen[]> {
  const rows = (await db
    .select({
      chefInvoiceId: chefInvoices.id,
      chefId: chefInvoices.chefId,
      chefNaam: chefs.fullName,
      bedragCents: chefInvoices.amountCents,
      referentie: chefInvoices.reference,
      periodeVan: chefInvoices.periodFrom,
      periodeTot: chefInvoices.periodTo,
      iban: chefs.ibanEncrypted,
    })
    .from(chefInvoices)
    .innerJoin(chefs, eq(chefs.id, chefInvoices.chefId))
    .leftJoin(betaalbatchRegels, eq(betaalbatchRegels.chefInvoiceId, chefInvoices.id))
    .where(
      and(
        eq(chefInvoices.status, "approved"),
        isNull(chefInvoices.paidAt),
        isNull(betaalbatchRegels.id), // nog niet in een batch
        isNull(chefs.deletedAt),
      ),
    )
    .orderBy(desc(chefInvoices.submittedAt))) as {
    chefInvoiceId: string; chefId: string; chefNaam: string; bedragCents: number;
    referentie: string | null; periodeVan: string | null; periodeTot: string | null; iban: string | null;
  }[];

  const uit: TeBetalen[] = [];
  for (const r of rows) {
    let betaalbaar = false;
    let reden: string | null = null;
    if (!r.iban) {
      reden = "geen rekeningnummer bekend";
    } else {
      try {
        betaalbaar = isGeldigIban(await decryptPii(r.iban));
        if (!betaalbaar) reden = "het opgeslagen rekeningnummer klopt niet";
      } catch {
        reden = "rekeningnummer kon niet gelezen worden";
      }
    }
    uit.push({
      chefInvoiceId: r.chefInvoiceId,
      chefId: r.chefId,
      chefNaam: r.chefNaam,
      bedragCents: r.bedragCents,
      referentie: r.referentie,
      periode: r.periodeVan && r.periodeTot ? `${r.periodeVan} t/m ${r.periodeTot}` : null,
      betaalbaar,
      reden,
    });
  }
  return uit;
}

export type BatchResultaat = { ok: true; batchId: string; nummer: string; aantal: number; totaalCents: number } | { ok: false; error: string };

/** "BET-2026-0001" — a fresh number per year, taken from what already exists. */
async function volgendNummer(jaar: number): Promise<string> {
  const [r] = (await db
    .select({ hoogste: sql<string | null>`max(${betaalbatches.nummer})` })
    .from(betaalbatches)
    .where(sql`${betaalbatches.nummer} like ${`BET-${jaar}-%`}`)) as { hoogste: string | null }[];
  const vorige = r?.hoogste ? Number(r.hoogste.split("-")[2]) : 0;
  return `BET-${jaar}-${String(vorige + 1).padStart(4, "0")}`;
}

/**
 * Compose a batch from the given invoices.
 *
 * The IBAN is snapshotted here, still encrypted. Nothing about a chef changing their bank
 * details next month may alter where last month's money went.
 */
export async function maakBetaalbatch(args: {
  chefInvoiceIds: string[];
  uitvoerDatum: string;
  actorUserId: string;
  notitie?: string;
}): Promise<BatchResultaat> {
  if (args.chefInvoiceIds.length === 0) return { ok: false, error: "Selecteer minstens één factuur." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.uitvoerDatum)) return { ok: false, error: "Ongeldige uitvoerdatum." };

  const kandidaten = (await getTeBetalen()).filter((t) => args.chefInvoiceIds.includes(t.chefInvoiceId));
  if (kandidaten.length === 0) return { ok: false, error: "Geen van deze facturen staat nog open — mogelijk zijn ze net betaald." };
  const onbetaalbaar = kandidaten.filter((k) => !k.betaalbaar);
  if (onbetaalbaar.length > 0) {
    return {
      ok: false,
      error: `Kan niet betalen aan ${onbetaalbaar.map((k) => `${k.chefNaam} (${k.reden})`).join(", ")}. Vul het rekeningnummer aan of haal ze uit de selectie.`,
    };
  }

  const nummer = await volgendNummer(new Date(args.uitvoerDatum).getUTCFullYear());
  const totaalCents = kandidaten.reduce((s, k) => s + k.bedragCents, 0);

  const [batch] = await db
    .insert(betaalbatches)
    .values({
      nummer,
      status: "concept",
      uitvoerDatum: args.uitvoerDatum,
      aantalRegels: kandidaten.length,
      totaalCents,
      notitie: args.notitie ?? null,
      aangemaaktDoor: args.actorUserId,
    })
    .returning({ id: betaalbatches.id });

  // Per regel invoegen zodat de unieke index per factuur kan afketsen zonder de rest mee
  // te nemen: raakt iemand anders ons voor, dan valt precies die ene regel weg.
  let geplaatst = 0;
  for (const k of kandidaten) {
    const [chef] = (await db.select({ iban: chefs.ibanEncrypted }).from(chefs).where(eq(chefs.id, k.chefId)).limit(1)) as { iban: string }[];
    const res = await db
      .insert(betaalbatchRegels)
      .values({
        batchId: batch.id,
        chefId: k.chefId,
        chefInvoiceId: k.chefInvoiceId,
        bedragCents: k.bedragCents,
        omschrijving: `Chef en Serve ${k.referentie ? `factuur ${k.referentie}` : "uitbetaling"}${k.periode ? ` ${k.periode}` : ""}`.slice(0, 140),
        naamSnapshot: k.chefNaam,
        ibanEncrypted: chef.iban,
      })
      .onConflictDoNothing({ target: betaalbatchRegels.chefInvoiceId })
      .returning({ id: betaalbatchRegels.id });
    if (res.length > 0) geplaatst++;
  }

  if (geplaatst === 0) {
    await db.delete(betaalbatches).where(eq(betaalbatches.id, batch.id));
    return { ok: false, error: "Deze facturen zitten al in een andere batch." };
  }
  if (geplaatst !== kandidaten.length) {
    // De tellingen moeten kloppen met wat er echt in staat, niet met wat we hoopten.
    const [som] = (await db
      .select({ n: sql<number>`count(*)::int`, totaal: sql<number>`coalesce(sum(${betaalbatchRegels.bedragCents}), 0)::int` })
      .from(betaalbatchRegels)
      .where(eq(betaalbatchRegels.batchId, batch.id))) as { n: number; totaal: number }[];
    await db.update(betaalbatches).set({ aantalRegels: som.n, totaalCents: som.totaal }).where(eq(betaalbatches.id, batch.id));
  }

  await recordAuditFromRequest({
    userId: args.actorUserId,
    action: "betaalbatches.created",
    resource: "betaalbatches",
    resourceId: batch.id,
    after: { nummer, aantal: geplaatst, totaalCents, uitvoerDatum: args.uitvoerDatum },
  }).catch(() => {});

  return { ok: true, batchId: batch.id, nummer, aantal: geplaatst, totaalCents };
}

export type SepaUitkomst = { ok: true; xml: string; bestandsnaam: string } | { ok: false; error: string };

/** Generate the bank file. Flips the batch to `generated` — still not "paid". */
export async function genereerSepa(batchId: string, actorUserId: string): Promise<SepaUitkomst> {
  const [batch] = (await db.select().from(betaalbatches).where(eq(betaalbatches.id, batchId)).limit(1)) as (typeof betaalbatches.$inferSelect)[];
  if (!batch) return { ok: false, error: "Deze batch bestaat niet." };
  if (batch.status === "paid") return { ok: false, error: "Deze batch is al als betaald gemarkeerd." };
  if (batch.status === "cancelled") return { ok: false, error: "Deze batch is geannuleerd." };

  const aannames = (await getMoneyAssumptions()) as Record<string, unknown>;
  const eigenIban = String(aannames.companyIban ?? "");
  const eigenNaam = String(aannames.companyName ?? "Chef & Serve");
  if (!eigenIban) {
    return { ok: false, error: "Het eigen rekeningnummer staat nog niet in de bedrijfsinstellingen (companyIban)." };
  }

  const regels = (await db.select().from(betaalbatchRegels).where(eq(betaalbatchRegels.batchId, batchId))) as (typeof betaalbatchRegels.$inferSelect)[];
  const betalingen: SepaBetaling[] = [];
  for (const r of regels) {
    betalingen.push({
      id: r.id.slice(0, 35),
      naam: r.naamSnapshot,
      iban: await decryptPii(r.ibanEncrypted),
      bedragCents: r.bedragCents,
      omschrijving: r.omschrijving,
    });
  }

  const res = bouwSepaBestand({
    berichtId: batch.nummer,
    opdrachtgeverNaam: eigenNaam,
    opdrachtgeverIban: eigenIban,
    opdrachtgeverBic: String(aannames.companyBic ?? "") || undefined,
    uitvoerDatum: batch.uitvoerDatum,
    betalingen,
    aangemaaktOp: new Date(),
  });
  if (!res.ok) return res;

  // Checksum van de inhoud, zodat je later kunt zien of het bestand dat je uploadde
  // hetzelfde is als wat wij hebben gemaakt.
  const checksum = await checksumVan(res.xml);
  await db
    .update(betaalbatches)
    .set({ status: "generated", gegenereerdOp: new Date(), bestandChecksum: checksum, updatedAt: new Date() })
    .where(and(eq(betaalbatches.id, batchId), sql`${betaalbatches.status} in ('concept','generated')`));

  await recordAuditFromRequest({
    userId: actorUserId,
    action: "betaalbatches.file_generated",
    resource: "betaalbatches",
    resourceId: batchId,
    after: { nummer: batch.nummer, regels: regels.length, checksum },
  }).catch(() => {});

  return { ok: true, xml: res.xml, bestandsnaam: `${batch.nummer}.xml` };
}

async function checksumVan(tekst: string): Promise<string> {
  const data = new TextEncoder().encode(tekst);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/**
 * Confirm the bank executed it. Only now do the invoices become paid.
 *
 * Separate from generating the file on purpose: a bank can refuse a batch, and marking
 * invoices paid off a file that was never executed is how a chef stops being paid while
 * the system insists they were.
 */
export async function markeerBetaald(batchId: string, actorUserId: string): Promise<{ ok: true; aantal: number } | { ok: false; error: string }> {
  const geclaimd = await db
    .update(betaalbatches)
    .set({ status: "paid", betaaldOp: new Date(), betaaldDoor: actorUserId, updatedAt: new Date() })
    .where(and(eq(betaalbatches.id, batchId), eq(betaalbatches.status, "generated")))
    .returning({ id: betaalbatches.id, nummer: betaalbatches.nummer });
  if (geclaimd.length === 0) {
    return { ok: false, error: "Alleen een batch waarvan het bestand is gegenereerd kan op betaald gezet worden." };
  }

  const regels = (await db.select({ invoiceId: betaalbatchRegels.chefInvoiceId }).from(betaalbatchRegels).where(eq(betaalbatchRegels.batchId, batchId))) as { invoiceId: string | null }[];
  let aantal = 0;
  for (const r of regels) {
    if (!r.invoiceId) continue;
    const u = await db
      .update(chefInvoices)
      .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
      .where(and(eq(chefInvoices.id, r.invoiceId), isNull(chefInvoices.paidAt)))
      .returning({ id: chefInvoices.id });
    aantal += u.length;
  }

  await recordAuditFromRequest({
    userId: actorUserId,
    action: "betaalbatches.marked_paid",
    resource: "betaalbatches",
    resourceId: batchId,
    after: { nummer: geclaimd[0].nummer, facturen: aantal },
  }).catch(() => {});
  return { ok: true, aantal };
}

export async function listBetaalbatches(limit = 25) {
  return (await db.select().from(betaalbatches).orderBy(desc(betaalbatches.createdAt)).limit(limit)) as (typeof betaalbatches.$inferSelect)[];
}
