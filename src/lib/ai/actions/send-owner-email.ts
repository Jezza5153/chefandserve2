/**
 * Owner-initiated freeform email — the action behind the `email.send` tool.
 *
 * Confirm-gated upstream: the executor mints a confirm token and the owner approves with a
 * recipient + subject + body preview before this runs, so the content is owner-approved.
 * Replies route to the owner (MAARTEN_EMAIL), not the noreply sender.
 */
import { OwnerMessageEmail } from "@/emails/OwnerMessageEmail";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

export type SendOwnerEmailResult = { ok: true; id: string } | { ok: false; error: string };

export async function sendOwnerEmail(args: {
  to: string;
  subject: string;
  body: string;
}): Promise<SendOwnerEmailResult> {
  // Maarten keeps a copy of every mail the assistant sends on his behalf (his stated
  // preference). Skip the CC when he IS the recipient, so Resend doesn't get a dup address.
  const cc =
    env.MAARTEN_EMAIL && env.MAARTEN_EMAIL.toLowerCase() !== args.to.toLowerCase()
      ? env.MAARTEN_EMAIL
      : undefined;
  const send = await sendEmail({
    to: args.to,
    subject: args.subject,
    react: OwnerMessageEmail({ title: args.subject, body: args.body }),
    replyTo: env.MAARTEN_EMAIL,
    cc,
  });
  return send.ok ? { ok: true, id: send.id } : { ok: false, error: send.error };
}
