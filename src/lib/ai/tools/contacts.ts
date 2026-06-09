/**
 * Contact-timeline tool — "wanneer/hoe spraken we [chef of klant] het laatst?". Reads the
 * contact_logs ops log. Read-only; owner-gated (chefs.read — the owner holds both chef +
 * client read, and contact logs are internal ops data).
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { contactTimeline } from "@/lib/ai/read-model/contacts";
import { logContactFromAi } from "@/lib/ai/actions/log-contact";

const CHANNEL_NL: Record<string, string> = {
  phone: "telefonisch", whatsapp: "via WhatsApp", email: "per e-mail", in_person: "persoonlijk",
};
const OUTCOME_NL: Record<string, string> = {
  spoken: "gesproken", no_answer: "geen gehoor", callback_requested: "terugbellen gevraagd", note_only: "notitie",
};

export const contactsTimeline = defineTool({
  name: "contacts.timeline",
  title: "Contactgeschiedenis (chef of klant)",
  description:
    "Wanneer en hoe er voor het laatst contact was met een chef of klant: kanaal (telefoon/WhatsApp/e-mail/persoonlijk), uitkomst en notitie — nieuwste eerst. Geef targetType ('chef' of 'client') + het id (via chefs.find / clients.find).",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({
    targetType: z.enum(["chef", "client"]),
    targetId: z.string().min(1, "targetId is verplicht"),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  run: async (input) => {
    const data = await contactTimeline({
      targetType: input.targetType,
      targetId: input.targetId,
      limit: input.limit ?? 10,
    });
    if (!data) throw new Error(input.targetType === "chef" ? "deze chef bestaat niet (meer)" : "deze klant bestaat niet (meer)");
    const last = data.entries[0];
    return {
      data,
      summary:
        data.entries.length === 0
          ? `Nog geen contactmomenten met ${data.target.name}.`
          : `${data.entries.length} contactmoment(en) met ${data.target.name}; laatste via ${last.channel}${last.outcome ? ` (${last.outcome})` : ""}.`,
    };
  },
});

export const contactsLog = defineTool({
  name: "contacts.log",
  title: "Contact vastleggen",
  description:
    "Leg een contactmoment vast met een chef of klant: kanaal (telefoon/WhatsApp/e-mail/persoonlijk), uitkomst (gesproken/geen gehoor/terugbellen/notitie) en een notitie. Voor 'noteer dat ik [chef/klant] sprak en …'. Schrijft in het contactlogboek — verschijnt in contacts.timeline en telt mee in de relatie-historie. Gebruik chefs.find / clients.find voor het id; geef de naam mee zodat de bevestiging duidelijk is.",
  risk: "outbound",
  permission: { resource: "chefs", action: "write" },
  input: z.object({
    targetType: z.enum(["chef", "client"]),
    targetId: z.string().min(1, "targetId is verplicht"),
    targetName: z.string().optional(),
    channel: z.enum(["phone", "whatsapp", "email", "in_person"]),
    outcome: z.enum(["spoken", "no_answer", "callback_requested", "note_only"]).optional(),
    note: z.string().min(1, "een notitie is verplicht"),
  }),
  describeAction: (i) =>
    `Contact vastleggen bij ${i.targetType === "chef" ? "chef" : "klant"} ${i.targetName ?? i.targetId} (${CHANNEL_NL[i.channel]}${i.outcome ? `, ${OUTCOME_NL[i.outcome]}` : ""}):\n"${i.note}"`,
  run: async (input, ctx) => {
    const { id } = await logContactFromAi({
      actorUserId: ctx.actor.requestedByUserId,
      targetType: input.targetType,
      targetId: input.targetId,
      channel: input.channel,
      outcome: input.outcome,
      note: input.note,
    });
    return {
      data: { id },
      summary: `Contact vastgelegd bij ${input.targetName ?? (input.targetType === "chef" ? "de chef" : "de klant")}.`,
    };
  },
});
