/**
 * One message to a filtered group of chefs — the 09:40 move when someone drops out.
 *
 * The eleven filter dimensions on the chef list already existed and so did every channel
 * (notification, e-mail), but nothing connected "this selection" to "one message sent".
 * The only options were messaging chefs one at a time or blasting everyone, and for an
 * agency covering a same-day gap that is the difference between a filled shift and a
 * phone call marathon.
 *
 * THE SHAPE OF THIS FILE IS A SAFETY ARGUMENT.
 *
 * - Selection reuses `findChefs`, the same function the list page and the assistant use.
 *   A second filter language would drift, and a drifted filter here means a message to the
 *   wrong people — which cannot be recalled.
 * - `previewBulkMessage` is separate from `sendBulkMessage` on purpose. You always get to
 *   see who and how many BEFORE anything leaves. The send takes a `verwachtAantal` and
 *   refuses if the group changed since the preview, so a chef who went inactive in between
 *   cannot silently alter the audience.
 * - Hard ceiling on group size. A filter typo that matches everyone should hit a wall, not
 *   an outbox.
 * - Dark-launched behind BULK_MESSAGE_ENABLED. Sending is irreversible and outbound; it
 *   stays off until someone deliberately turns it on.
 */
import { inArray, isNull, and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import { findChefs, type FindChefsInput } from "@/lib/ai/read-model/directory";
import { createNotification } from "@/lib/integrations/notifications";
import { recordEmailMessage } from "@/lib/integrations";
import { recordAuditFromRequest } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { OwnerMessageEmail } from "@/emails/OwnerMessageEmail";

/** Above this a "message the group" is almost certainly a mis-filter, not an intention. */
export const MAX_ONTVANGERS = 200;

export type BulkOntvanger = {
  chefId: string;
  naam: string;
  email: string | null;
  userId: string | null;
};

export type BulkVoorbeeld = {
  ontvangers: BulkOntvanger[];
  /** Everyone the filter matched, including those we cannot reach. */
  gevonden: number;
  /** Matched but unreachable — no e-mail and no portal account. */
  onbereikbaar: BulkOntvanger[];
  teGroot: boolean;
};

/** Who WOULD get this. Always call before sending; never sends anything itself. */
export async function previewBulkMessage(filter: FindChefsInput): Promise<BulkVoorbeeld> {
  // maxLimit, niet alleen limit: findChefs kapt standaard op 25 af om tool-resultaten
  // klein te houden. Hier is dat gevaarlijk — een afgekapte lijst laat je denken dat je de
  // hele groep bereikte terwijl je de eerste 25 bereikte.
  const { chefs: hits } = await findChefs({
    ...filter,
    limit: MAX_ONTVANGERS + 1,
    maxLimit: MAX_ONTVANGERS + 1,
  });
  const ids = hits.map((h) => h.id);
  if (ids.length === 0) return { ontvangers: [], gevonden: 0, onbereikbaar: [], teGroot: false };

  const rows = (await db
    .select({ chefId: chefs.id, naam: chefs.fullName, email: chefs.email, userId: chefs.userId })
    .from(chefs)
    .where(and(inArray(chefs.id, ids), isNull(chefs.deletedAt)))) as BulkOntvanger[];

  const bereikbaar = rows.filter((r) => r.email || r.userId);
  const onbereikbaar = rows.filter((r) => !r.email && !r.userId);
  return {
    ontvangers: bereikbaar,
    gevonden: rows.length,
    onbereikbaar,
    teGroot: rows.length > MAX_ONTVANGERS,
  };
}

export type BulkResultaat =
  | { ok: true; verstuurd: number; overgeslagen: number }
  | { ok: false; error: string };

export type BulkInvoer = {
  filter: FindChefsInput;
  onderwerp: string;
  bericht: string;
  /** From the preview. A mismatch aborts — the audience must be the one that was shown. */
  verwachtAantal: number;
  actorUserId: string;
};

export function bulkMessageEnabled(): boolean {
  return process.env.BULK_MESSAGE_ENABLED === "true";
}

export async function sendBulkMessage(inv: BulkInvoer): Promise<BulkResultaat> {
  if (!bulkMessageEnabled()) {
    return { ok: false, error: "Groepsberichten staan uit (BULK_MESSAGE_ENABLED)." };
  }
  const onderwerp = inv.onderwerp.trim();
  const bericht = inv.bericht.trim();
  if (!onderwerp) return { ok: false, error: "Geef het bericht een onderwerp." };
  if (bericht.length < 10) return { ok: false, error: "Het bericht is wel erg kort — schrijf even een hele zin." };

  const voorbeeld = await previewBulkMessage(inv.filter);
  if (voorbeeld.teGroot) {
    return { ok: false, error: `Dit raakt meer dan ${MAX_ONTVANGERS} chefs. Maak de selectie kleiner.` };
  }
  if (voorbeeld.ontvangers.length === 0) return { ok: false, error: "Deze selectie levert niemand op." };
  // The group must be the one that was on screen. Between preview and send a chef can go
  // inactive or a filter can be edited in another tab; silently sending to a different set
  // than the one that was confirmed is exactly the mistake this guards.
  if (voorbeeld.ontvangers.length !== inv.verwachtAantal) {
    return {
      ok: false,
      error: `De groep is veranderd sinds je hem bekeek (${inv.verwachtAantal} → ${voorbeeld.ontvangers.length}). Controleer de selectie opnieuw.`,
    };
  }

  let verstuurd = 0;
  let overgeslagen = 0;
  for (const ont of voorbeeld.ontvangers) {
    let geraakt = false;
    if (ont.userId) {
      await createNotification({
        userId: ont.userId,
        type: "chef.bulk_message",
        title: onderwerp,
        body: bericht,
        actionUrl: "/chef",
        entityType: "chefs",
        entityId: ont.chefId,
      }).catch(() => {});
      geraakt = true;
    }
    if (ont.email) {
      try {
        // Reuses OwnerMessageEmail — the same envelope the assistant already sends
        // freeform mail in, so a group message does not look like a different company.
        const res = await sendEmail({
          to: ont.email,
          subject: onderwerp,
          react: OwnerMessageEmail({
            title: onderwerp,
            body: `Hoi ${ont.naam.split(" ")[0]},\n\n${bericht}`,
          }),
        });
        await recordEmailMessage({
          providerMessageId: (res as { id?: string })?.id ?? "",
          toEmail: ont.email,
          template: "OwnerMessageEmail",
          eventKey: "chef.bulk_message",
          entityType: "chefs",
          entityId: ont.chefId,
          ...(ont.userId ? { userId: ont.userId } : {}),
        }).catch(() => {});
        geraakt = true;
      } catch {
        // One bad address must not stop the rest of the group.
      }
    }
    if (geraakt) verstuurd++;
    else overgeslagen++;
  }

  await recordAuditFromRequest({
    userId: inv.actorUserId,
    action: "chefs.bulk_message_sent",
    resource: "chefs",
    resourceId: "bulk",
    after: {
      onderwerp,
      aantal: verstuurd,
      overgeslagen,
      filter: inv.filter,
      // The body is recorded too: "what exactly did we send them" is the first question
      // anyone asks afterwards.
      bericht: bericht.slice(0, 2000),
    },
  }).catch(() => {});

  return { ok: true, verstuurd, overgeslagen };
}

/** One chef, for the preview list — resolves a name without exposing the whole row. */
export async function chefNaam(chefId: string): Promise<string | null> {
  const [r] = (await db.select({ naam: chefs.fullName }).from(chefs).where(eq(chefs.id, chefId)).limit(1)) as { naam: string }[];
  return r?.naam ?? null;
}
