/**
 * Communication tools. `email.send` lets the assistant send a freeform email on Maarten's
 * behalf — outbound, so confirm-gated: the owner sees recipient + subject + a body preview
 * and must approve before it goes out. (For a chef hours-reminder use hours.send_reminder.)
 */
import { z } from "zod";
import { eq } from "drizzle-orm";

import { defineTool } from "@/lib/ai/tools/registry";
import { sendOwnerEmail } from "@/lib/ai/actions/send-owner-email";
import { recipientsForClient } from "@/lib/domain/client-recipients";
import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import { env } from "@/lib/env";

const previewBody = (body: string) => (body.length > 600 ? `${body.slice(0, 600)}…` : body);

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
  describeAction: (input) => {
    const ccLine =
      env.MAARTEN_EMAIL && env.MAARTEN_EMAIL.toLowerCase() !== input.to.toLowerCase()
        ? `\nCC: ${env.MAARTEN_EMAIL} (jij, kopie)`
        : "";
    return `E-mail sturen naar ${input.to}${ccLine}\nOnderwerp: ${input.subject}\n\n${
      input.body.length > 600 ? `${input.body.slice(0, 600)}…` : input.body
    }`;
  },
  run: async (input) => {
    const res = await sendOwnerEmail({ to: input.to, subject: input.subject, body: input.body });
    if (!res.ok) throw new Error(res.error);
    return { data: { to: input.to, id: res.id }, summary: `E-mail verstuurd naar ${input.to}.` };
  },
});

/**
 * Send to a CLIENT by id — no address needed. Resolves the recipient(s) via
 * recipientsForClient (AVG-safe, respects opt-outs), so the assistant never has to ask
 * "which email?". The model passes clientName purely for the confirm preview (describeAction
 * is sync); the actual send uses clientId. Confirm-gated like email.send.
 */
export const emailSendToClient = defineTool({
  name: "email.send_to_client",
  title: "E-mail naar een klant",
  description:
    "Stuur namens Maarten een e-mail naar een KLANT — je hoeft GEEN e-mailadres te kennen. Geef het klant-id (via clients.find) plus clientName, onderwerp en bericht; de juiste ontvanger(s) worden automatisch bepaald. Gebruik dit zodra de gebruiker 'mail de klant / stuur <klant> een bericht' vraagt. Vraag NOOIT om een e-mailadres — zoek de klant op met clients.find en gebruik het id.",
  risk: "outbound",
  permission: { resource: "reminders", action: "write" },
  input: z.object({
    clientId: z.string().min(1, "clientId is verplicht (gebruik clients.find)"),
    clientName: z.string().optional(),
    subject: z.string().min(1, "Onderwerp is verplicht"),
    body: z.string().min(1, "Bericht mag niet leeg zijn"),
  }),
  describeAction: (input) =>
    `E-mail sturen naar ${input.clientName?.trim() || "de klant"} (kopie naar jou)\nOnderwerp: ${input.subject}\n\n${previewBody(input.body)}`,
  run: async (input) => {
    const tos = await recipientsForClient(input.clientId, "generic");
    if (tos.length === 0) {
      throw new Error("Geen e-mailadres bekend voor deze klant — voeg er een toe op de klantpagina.");
    }
    const ids: string[] = [];
    for (const to of tos) {
      const res = await sendOwnerEmail({ to, subject: input.subject, body: input.body });
      if (!res.ok) throw new Error(res.error);
      ids.push(res.id);
    }
    const who = input.clientName?.trim() || "de klant";
    return {
      data: { clientId: input.clientId, recipients: tos.length, ids },
      summary: `E-mail verstuurd naar ${who} (${tos.length} ontvanger${tos.length === 1 ? "" : "s"}).`,
    };
  },
});

/** Send to a CHEF by id — no address needed; resolves chefs.email internally. */
export const emailSendToChef = defineTool({
  name: "email.send_to_chef",
  title: "E-mail naar een chef",
  description:
    "Stuur namens Maarten een e-mail naar een CHEF — geen adres nodig. Geef het chef-id (via chefs.find) plus chefName, onderwerp en bericht. Vraag NOOIT om een e-mailadres; zoek de chef op met chefs.find en gebruik het id.",
  risk: "outbound",
  permission: { resource: "reminders", action: "write" },
  input: z.object({
    chefId: z.string().min(1, "chefId is verplicht (gebruik chefs.find)"),
    chefName: z.string().optional(),
    subject: z.string().min(1, "Onderwerp is verplicht"),
    body: z.string().min(1, "Bericht mag niet leeg zijn"),
  }),
  describeAction: (input) =>
    `E-mail sturen naar ${input.chefName?.trim() || "de chef"} (kopie naar jou)\nOnderwerp: ${input.subject}\n\n${previewBody(input.body)}`,
  run: async (input) => {
    const [chef] = await db
      .select({ email: chefs.email, fullName: chefs.fullName })
      .from(chefs)
      .where(eq(chefs.id, input.chefId))
      .limit(1);
    if (!chef?.email) throw new Error("Geen e-mailadres bekend voor deze chef.");
    const res = await sendOwnerEmail({ to: chef.email, subject: input.subject, body: input.body });
    if (!res.ok) throw new Error(res.error);
    return { data: { chefId: input.chefId, id: res.id }, summary: `E-mail verstuurd naar ${chef.fullName ?? "de chef"}.` };
  },
});
