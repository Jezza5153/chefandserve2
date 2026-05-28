/**
 * Missing-data workflow — Cockpit PR-2.1. "Vraag ontbrekende gegevens": one
 * click sends a chef the intake form and records WHO got WHICH form, WHICH
 * fields, and whether it was completed (matched back when the chef re-submits).
 *
 * Each request writes a `profile_data_requests` row + a `contact_logs` row (so
 * the contact history stays unified) and, for the email channel, sends the form
 * link. `markCompletedByEmail` closes the loop when a new intake lands.
 */

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import { chefs, contactLogs, profileDataRequests } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { recordEmailMessage } from "@/lib/integrations";
import { site } from "@/lib/site";
import { ProfileDataRequestEmail } from "@/emails/ProfileDataRequestEmail";

export type RequestChannel = "email" | "whatsapp" | "phone";

/** Dutch labels for the fields we ask a chef to complete. */
export const FIELD_LABELS: Record<string, string> = {
  vakniveau: "Vakniveau",
  stad: "Woonplaats",
  postcode: "Postcode",
  tarief: "Uurtarief",
  contact: "Telefoon/e-mail",
  vervoer: "Vervoer",
  voorkeuren: "Voorkeuren",
  segmenten: "Segmenten",
  ervaring: "Ervaring",
};

export async function createProfileDataRequest(args: {
  chefId: string;
  requestedFields: string[];
  channel?: RequestChannel;
  requestType?: string;
  createdBy: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const [chef] = await db
    .select({ email: chefs.email, fullName: chefs.fullName, phone: chefs.phone })
    .from(chefs)
    .where(eq(chefs.id, args.chefId))
    .limit(1);
  if (!chef) return { ok: false, error: "Chef niet gevonden." };

  const channel = args.channel ?? "email";
  const labels = args.requestedFields.map((f) => FIELD_LABELS[f] ?? f);
  const sentTo = channel === "email" ? chef.email : chef.phone;

  // Unified contact history.
  const [cl] = await db
    .insert(contactLogs)
    .values({
      actorUserId: args.createdBy,
      targetType: "chef",
      targetId: args.chefId,
      channel,
      entityType: "profile_data_request",
      outcome: "note_only",
      note: `Profielverzoek: ${labels.join(", ")}`,
    })
    .returning({ id: contactLogs.id });

  let status = "sent";
  if (channel === "email") {
    if (!chef.email) {
      status = "failed";
    } else {
      const send = await sendEmail({
        to: chef.email,
        subject: "Vul je gegevens aan — Chef & Serve",
        react: ProfileDataRequestEmail({
          chefName: chef.fullName,
          missingLabels: labels,
          formUrl: site.jotform.chef,
        }),
      });
      if (send.ok) {
        await recordEmailMessage({
          providerMessageId: send.id,
          toEmail: chef.email,
          template: "ProfileDataRequestEmail",
          eventKey: "profile_data_request",
          entityType: "chefs",
          entityId: args.chefId,
        });
      } else {
        status = "failed";
      }
    }
  }
  // whatsapp/phone: the admin sends out-of-band (UI offers a wa.me link); we
  // record the request as "sent" so the pipeline shows it was actioned.

  const [row] = await db
    .insert(profileDataRequests)
    .values({
      chefId: args.chefId,
      requestType: args.requestType ?? "profile_update",
      requestedFields: args.requestedFields,
      channel,
      status,
      sentTo,
      sentAt: status === "sent" ? new Date() : null,
      createdBy: args.createdBy,
      messageTemplateKey: channel === "email" ? "ProfileDataRequestEmail" : null,
      contactLogId: cl?.id ?? null,
    })
    .returning({ id: profileDataRequests.id });

  await recordAuditFromRequest({
    userId: args.createdBy,
    action: "profile_data_request.created",
    resource: "profile_data_requests",
    resourceId: row.id,
    after: { chefId: args.chefId, channel, status, fields: args.requestedFields },
  });

  return { ok: status !== "failed", id: row.id, error: status === "failed" ? "Versturen mislukt." : undefined };
}

export async function listProfileDataRequests(chefId: string) {
  return db
    .select()
    .from(profileDataRequests)
    .where(eq(profileDataRequests.chefId, chefId))
    .orderBy(desc(profileDataRequests.createdAt))
    .limit(10);
}

/**
 * Close the loop: when a chef (re)submits intake, mark their open requests
 * completed. Matches by email → chef ids. Returns the number completed.
 */
export async function markCompletedByEmail(
  email: string | null | undefined,
  jotformSubmissionId?: string | null,
): Promise<number> {
  if (!email) return 0;
  const lower = email.trim().toLowerCase();
  const chefRows = await db
    .select({ id: chefs.id })
    .from(chefs)
    .where(eq(chefs.email, lower));
  const chefIds = chefRows.map((c) => c.id);
  if (chefIds.length === 0) return 0;
  const updated = await db
    .update(profileDataRequests)
    .set({ status: "completed", completedAt: new Date(), jotformSubmissionId: jotformSubmissionId ?? null })
    .where(
      and(
        inArray(profileDataRequests.chefId, chefIds),
        inArray(profileDataRequests.status, ["draft", "sent"]),
      ),
    )
    .returning({ id: profileDataRequests.id });
  return updated.length;
}
