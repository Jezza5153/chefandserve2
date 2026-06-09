/**
 * Log a contact moment (phone/WhatsApp/e-mail/in-person + outcome + note) with a chef or klant —
 * the action behind the `contacts.log` tool. Confirm-gated upstream (the owner approves the note +
 * target before this runs). Writes one contact_logs row; it then shows up in contacts.timeline and
 * feeds the relationship history. Mirrors the app's logContact server action.
 */
import { db } from "@/lib/db/client";
import { contactLogs } from "@/lib/db/schema";

export async function logContactFromAi(args: {
  actorUserId: string;
  targetType: "chef" | "client";
  targetId: string;
  channel: string;
  outcome?: string;
  note: string;
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(contactLogs)
    .values({
      actorUserId: args.actorUserId,
      targetType: args.targetType,
      targetId: args.targetId,
      channel: args.channel,
      outcome: args.outcome ?? "note_only",
      note: args.note,
    })
    .returning({ id: contactLogs.id });
  return { id: row.id };
}
