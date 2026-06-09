/**
 * Inbound-comms tool — "wat is er binnengekomen van chefs/klanten?". Read-only. Returns sender +
 * subject + classification (klacht/spoed/vraag/overig) — NEVER the raw body (untrusted content
 * stays out of the model's context; the owner opens the mail itself for the full text).
 */
import { z } from "zod";

import { listRecentInbound } from "@/lib/domain/inbound";
import { defineTool } from "@/lib/ai/tools/registry";

export const inboundList = defineTool({
  name: "inbound.list",
  title: "Binnengekomen berichten",
  description:
    "Wat is er per e-mail BINNENGEKOMEN van chefs/klanten (onze inbox)? Geeft afzender, onderwerp en classificatie (⚠ klacht / ⏱ spoed / vraag / overig), nieuwste eerst. Optioneel `unhandledOnly` (alleen nog niet afgehandeld) en `limit`. Read-only. Toont bewust NIET de volledige berichttekst — afzenderinhoud is onbetrouwbaar; open de mail zelf voor de inhoud.",
  risk: "read",
  permission: { resource: "clients", action: "read" },
  input: z.object({
    unhandledOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  run: async (input) => {
    const items = await listRecentInbound({ unhandledOnly: input.unhandledOnly, limit: input.limit });
    if (items.length === 0) {
      return { data: { count: 0, items: [] }, summary: "Geen binnengekomen berichten." };
    }
    const flagged = items.filter((i) => i.category === "complaint" || i.category === "urgent");
    const head = items
      .slice(0, 5)
      .map((i) => {
        const mark = i.category === "complaint" ? "⚠ " : i.category === "urgent" ? "⏱ " : "";
        const who = i.from.split("<")[0].trim() || i.from;
        return `${mark}${who}${i.subject ? ` — "${i.subject}"` : ""}`;
      })
      .join("; ");
    return {
      data: { count: items.length, flagged: flagged.length, items },
      summary: `${items.length} bericht(en)${flagged.length ? `, waarvan ${flagged.length} klacht/spoed` : ""}: ${head}${items.length > 5 ? " …" : ""}.`,
    };
  },
});
