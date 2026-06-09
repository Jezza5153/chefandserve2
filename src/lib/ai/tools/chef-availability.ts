/**
 * chefs.availability — one chef's submitted availability for the coming period (owner view).
 * Read-only, owner-gated (chefs.read).
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { chefAvailabilityForAi } from "@/lib/ai/read-model/chef-availability";

export const chefsAvailability = defineTool({
  name: "chefs.availability",
  title: "Beschikbaarheid van een chef",
  description:
    "De doorgegeven beschikbaarheid van één chef voor de komende periode (standaard 30 dagen): welke dagen geblokkeerd zijn (niet beschikbaar, met eventuele reden) en welke expliciet als vrij zijn gemarkeerd. Voor 'wanneer is chef X beschikbaar / is hij zaterdag vrij / welke dagen heeft Lisa geblokkeerd?'. Read-only. Gebruik chefs.find voor het chefId.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({
    chefId: z.string().min(1, "chefId is verplicht"),
    days: z.number().int().min(1).max(90).optional(),
  }),
  run: async (input) => {
    const d = await chefAvailabilityForAi({ chefId: input.chefId, days: input.days ?? 30 });
    if (!d) throw new Error("deze chef bestaat niet (meer)");
    return {
      data: d,
      summary:
        d.doorgegeven === 0
          ? `${d.chef} heeft nog geen beschikbaarheid doorgegeven voor de komende ${d.dagen} dagen.`
          : `${d.chef}: ${d.geblokkeerd.length} geblokkeerde dag(en), ${d.expliciet_vrij.length} expliciet vrij (komende ${d.dagen} dagen).`,
    };
  },
});
