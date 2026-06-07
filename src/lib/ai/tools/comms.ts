/**
 * Communication tools. `email.send` lets the assistant send a freeform email on Maarten's
 * behalf — outbound, so confirm-gated: the owner sees recipient + subject + a body preview
 * and must approve before it goes out. (For a chef hours-reminder use hours.send_reminder.)
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { sendOwnerEmail } from "@/lib/ai/actions/send-owner-email";

export const emailSend = defineTool({
  name: "email.send",
  title: "E-mail versturen",
  description:
    "Stuur namens Maarten een e-mail naar één ontvanger (vrije tekst: onderwerp + bericht). Gebruik dit voor losse mails. Voor een uren-herinnering aan een chef is er een aparte tool (hours.send_reminder).",
  risk: "outbound",
  permission: { resource: "reminders", action: "write" },
  input: z.object({
    to: z.string().email("Geen geldig e-mailadres"),
    subject: z.string().min(1, "Onderwerp is verplicht"),
    body: z.string().min(1, "Bericht mag niet leeg zijn"),
  }),
  describeAction: (input) =>
    `E-mail sturen naar ${input.to}\nOnderwerp: ${input.subject}\n\n${
      input.body.length > 600 ? `${input.body.slice(0, 600)}…` : input.body
    }`,
  run: async (input) => {
    const res = await sendOwnerEmail({ to: input.to, subject: input.subject, body: input.body });
    if (!res.ok) throw new Error(res.error);
    return { data: { to: input.to, id: res.id }, summary: `E-mail verstuurd naar ${input.to}.` };
  },
});
