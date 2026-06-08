/**
 * Contact-timeline tool — "wanneer/hoe spraken we [chef of klant] het laatst?". Reads the
 * contact_logs ops log. Read-only; owner-gated (chefs.read — the owner holds both chef +
 * client read, and contact logs are internal ops data).
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { contactTimeline } from "@/lib/ai/read-model/contacts";

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
