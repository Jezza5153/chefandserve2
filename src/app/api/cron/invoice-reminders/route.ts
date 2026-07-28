/**
 * GET /api/cron/invoice-reminders — chase overdue klant invoices.
 *
 * The last piece of the money chain, and deliberately built last: chasing an amount that
 * does not yet include surcharges, fees and passed-on costs is worse than not chasing,
 * because the klant pays the number you sent and the rest has to be argued for afterwards.
 *
 * `?dryRun=1` returns exactly who WOULD be chased without sending anything, so the sweep
 * can be inspected on production before the flag is ever flipped.
 *
 * Idempotent: the invoice is CLAIMED (lastReminderAt + reminderCount, one statement with
 * the same conditions as the selection) before a single mail goes out. A retried cron, a
 * manual hit and a double-fire all collapse into one reminder.
 *
 * Dark-launched: no-op unless INVOICE_REMINDERS_ENABLED=true. Auth: Bearer CRON_SECRET.
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { OwnerMessageEmail } from "@/emails/OwnerMessageEmail";
import { recipientsForClient } from "@/lib/domain/client-recipients";
import {
  aanmaningToon,
  claimAanmaning,
  euro,
  getAanmaningKandidaten,
  remindersEnabled,
} from "@/lib/domain/invoice-reminders";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { recordEmailMessage } from "@/lib/integrations";
import { createNotification } from "@/lib/integrations/notifications";
import { db } from "@/lib/db/client";
import { clients } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!env.CRON_SECRET) return NextResponse.json({ error: "no_cron_secret" }, { status: 503 });
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const kandidaten = await getAanmaningKandidaten(new Date());
  const teMailen = kandidaten.filter((k) => !k.handmatig);
  const handmatig = kandidaten.filter((k) => k.handmatig);

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      enabled: remindersEnabled(),
      zouMailen: teMailen.map((k) => ({
        factuur: k.nummer, klant: k.klant, bedrag: euro(k.bedragCents),
        dagenTeLaat: k.dagenTeLaat, eerdere: k.eerdereAanmaningen,
      })),
      handmatigOppakken: handmatig.map((k) => ({ factuur: k.nummer, klant: k.klant, bedrag: euro(k.bedragCents) })),
    });
  }

  if (!remindersEnabled()) {
    return NextResponse.json({ skipped: "disabled", zouMailen: teMailen.length, handmatig: handmatig.length });
  }

  let verstuurd = 0;
  let overgeslagen = 0;
  for (const k of teMailen) {
    // Claim FIRST. If a mail then fails we have chased once too few, never once too many —
    // the safe side of the trade when the other side is a klant getting two demands.
    if (!(await claimAanmaning(k.invoiceId))) {
      overgeslagen++;
      continue;
    }
    const toon = aanmaningToon(k.eerdereAanmaningen + 1);
    const onderwerp = toon.onderwerp(k.nummer);
    const tekst =
      `${toon.opening}\n\n` +
      `Factuur ${k.nummer} van ${euro(k.bedragCents)} verviel op ` +
      `${new Date(k.vervaldatum).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })} ` +
      `— dat is ${k.dagenTeLaat} dagen geleden.\n\n${toon.slot}`;

    // recipientsForClient, never client.email: billing mail has its own address and its
    // own role, and that is a hard rule in this codebase.
    const ontvangers = await recipientsForClient(k.clientId, "invoice_sent");
    for (const adres of ontvangers) {
      try {
        const res = await sendEmail({
          to: adres,
          subject: onderwerp,
          react: OwnerMessageEmail({ title: onderwerp, body: tekst }),
        });
        await recordEmailMessage({
          providerMessageId: (res as { id?: string })?.id ?? "",
          toEmail: adres,
          template: "OwnerMessageEmail",
          eventKey: "invoice_reminder",
          entityType: "invoices",
          entityId: k.invoiceId,
        }).catch(() => {});
      } catch {
        // One bad address must not stop the sweep.
      }
    }

    const [klant] = await db.select({ userId: clients.userId }).from(clients).where(eq(clients.id, k.clientId)).limit(1);
    if (klant?.userId) {
      await createNotification({
        userId: klant.userId,
        type: "invoice.reminder",
        title: onderwerp,
        body: `${euro(k.bedragCents)} — ${k.dagenTeLaat} dagen over de vervaldatum.`,
        actionUrl: "/client/invoices",
        entityType: "invoices",
        entityId: k.invoiceId,
      }).catch(() => {});
    }
    verstuurd++;
  }

  return NextResponse.json({
    verstuurd,
    overgeslagen,
    handmatigOppakken: handmatig.map((k) => ({ factuur: k.nummer, klant: k.klant })),
  });
}
