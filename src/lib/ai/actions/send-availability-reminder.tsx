/**
 * Side-effectful action: remind chefs to fill in their availability for next week. Powers
 * the confirm-gated `chefs.send_availability_reminder` tool. Sends to ONE chef (chefId) or
 * to ALL active, portal-enabled chefs. Email (sendEmail + recordEmailMessage) + an in-app
 * notification per chef — the same send→record→notify cascade as send-hours-reminder.
 *
 * On-demand (Maarten triggers it), so — unlike the weekly worker — it does NOT dedupe:
 * if he asks to remind everyone now, everyone gets it now.
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { env } from "@/lib/env";
import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { createNotification, recordEmailMessage } from "@/lib/integrations";

export type AvailabilityReminderResult =
  | { ok: true; sent: number; skipped: number; recipients: string[] }
  | { ok: false; reason: string };

function reminderEmail(firstName: string) {
  const url = `${env.NEXT_PUBLIC_APP_URL}/chef/availability`;
  return (
    <div>
      <h1>Geef je beschikbaarheid voor volgende week door</h1>
      <p>{`Hé ${firstName}, wil je even checken of je beschikbaarheid voor volgende week klopt? Dan kunnen we je voor de juiste diensten inplannen.`}</p>
      <p>
        <a href={url}>Beschikbaarheid bijwerken</a>
      </p>
      <p>Heb je niets te blokkeren? Dan hoef je niets te doen — we gaan ervan uit dat je beschikbaar bent.</p>
    </div>
  );
}

export async function sendAvailabilityReminder(args: { chefId?: string }): Promise<AvailabilityReminderResult> {
  const targets = await db
    .select({ id: chefs.id, fullName: chefs.fullName, email: chefs.email, userId: chefs.userId })
    .from(chefs)
    .where(
      args.chefId
        ? eq(chefs.id, args.chefId)
        : and(
            eq(chefs.status, "active"),
            isNotNull(chefs.email),
            isNotNull(chefs.userId),
            isNull(chefs.deletedAt),
          ),
    );

  if (targets.length === 0) {
    return {
      ok: false,
      reason: args.chefId ? "Chef niet gevonden." : "Geen actieve chefs met e-mailadres gevonden.",
    };
  }
  if (args.chefId && !targets[0]?.email) {
    return { ok: false, reason: "Deze chef heeft geen e-mailadres." };
  }

  let sent = 0;
  let skipped = 0;
  const recipients: string[] = [];
  for (const c of targets) {
    if (!c.email) {
      skipped++;
      continue;
    }
    const firstName = c.fullName.split(" ")[0] || c.fullName;
    const send = await sendEmail({
      to: c.email,
      subject: "Vul je beschikbaarheid voor volgende week in",
      react: reminderEmail(firstName),
    });
    if (!send.ok) {
      skipped++;
      continue;
    }
    sent++;
    recipients.push(c.email);
    await recordEmailMessage({
      providerMessageId: send.id,
      toEmail: c.email,
      template: "AvailabilityReminderInline",
      eventKey: "availability_reminder",
      entityType: "chef",
      entityId: c.id,
      userId: c.userId ?? undefined,
    });
    if (c.userId) {
      await createNotification({
        userId: c.userId,
        type: "availability_reminder",
        title: "Beschikbaarheid volgende week",
        body: "Geef je beschikbaarheid voor volgende week door.",
        actionUrl: "/chef/availability",
        entityType: "chef",
        entityId: c.id,
      });
    }
  }
  return { ok: true, sent, skipped, recipients };
}
