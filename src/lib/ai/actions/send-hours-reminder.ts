/**
 * Side-effectful action: remind the party currently blocking an hours row.
 *   - chef must (re)submit  → status draft / client_rejected / admin_rejected
 *   - klant must sign        → status submitted
 *   - anything else          → no-op (waiting on the owner, or already done)
 *
 * Reuses the existing HoursReminder* templates + the standard send→record→notify
 * cascade. Wrapped by the confirm-gated `hours.send_reminder` tool.
 */
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email";
import { createNotification, recordEmailMessage } from "@/lib/integrations";
import { recipientsForClient } from "@/lib/domain/client-recipients";
import { HoursReminderChefEmail } from "@/emails/HoursReminderChefEmail";
import { HoursReminderKlantEmail } from "@/emails/HoursReminderKlantEmail";
import { loadHoursReminderTarget } from "@/lib/ai/read-model/hours";

const CHEF_PENDING: string[] = ["draft", "client_rejected", "admin_rejected"];
const KLANT_PENDING: string[] = ["submitted"];

export type SendReminderResult =
  | { ok: true; party: "chef" | "klant"; recipients: string[] }
  | { ok: false; reason: string };

export async function sendHoursReminder(hoursId: string): Promise<SendReminderResult> {
  const row = await loadHoursReminderTarget(hoursId);
  if (!row) return { ok: false, reason: "Urenregel niet gevonden." };
  const shiftDate = new Date(row.shiftStartsAt).toISOString();

  if (CHEF_PENDING.includes(row.status)) {
    if (!row.chefEmail) return { ok: false, reason: "Deze chef heeft geen e-mailadres." };
    const submitUrl = `${env.NEXT_PUBLIC_APP_URL}/chef/hours/${row.placementId}`;
    const send = await sendEmail({
      to: row.chefEmail,
      subject: "Herinnering: vul je uren in",
      react: HoursReminderChefEmail({
        recipientName: row.chefFullName,
        clientName: row.clientCompanyName,
        shiftDate,
        stage: "72h",
        submitUrl,
      }),
    });
    if (!send.ok) return { ok: false, reason: send.error };
    await recordEmailMessage({
      providerMessageId: send.id,
      toEmail: row.chefEmail,
      template: "HoursReminderChefEmail",
      eventKey: "hours_reminder",
      entityType: "shift_hours",
      entityId: hoursId,
      userId: row.chefUserId ?? undefined,
    });
    if (row.chefUserId) {
      await createNotification({
        userId: row.chefUserId,
        type: "hours_reminder",
        title: "Herinnering: vul je uren in",
        body: `Voor je dienst bij ${row.clientCompanyName}.`,
        actionUrl: `/chef/hours/${row.placementId}`,
        entityType: "shift_hours",
        entityId: hoursId,
      });
    }
    return { ok: true, party: "chef", recipients: [row.chefEmail] };
  }

  if (KLANT_PENDING.includes(row.status)) {
    const to = await recipientsForClient(row.clientId, "hours_ready_to_sign");
    if (to.length === 0) return { ok: false, reason: "Geen e-mailadres bekend bij deze klant." };
    const signUrl = `${env.NEXT_PUBLIC_APP_URL}/client/shifts/${row.shiftId}/hours`;
    const send = await sendEmail({
      to,
      subject: "Herinnering: keur de uren goed",
      react: HoursReminderKlantEmail({
        recipientName: row.clientCompanyName,
        chefName: row.chefFullName,
        shiftDate,
        signUrl,
      }),
    });
    if (!send.ok) return { ok: false, reason: send.error };
    for (const addr of to) {
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: addr,
        template: "HoursReminderKlantEmail",
        eventKey: "hours_reminder",
        entityType: "shift_hours",
        entityId: hoursId,
      });
    }
    if (row.clientUserId) {
      await createNotification({
        userId: row.clientUserId,
        type: "hours_reminder",
        title: "Herinnering: uren goedkeuren",
        body: `Voor ${row.chefFullName}.`,
        actionUrl: `/client/shifts/${row.shiftId}/hours`,
        entityType: "shift_hours",
        entityId: hoursId,
      });
    }
    return { ok: true, party: "klant", recipients: to };
  }

  return { ok: false, reason: "Deze uren wachten niet op de chef of klant — geen herinnering nodig." };
}
