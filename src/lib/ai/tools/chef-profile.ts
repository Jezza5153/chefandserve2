/**
 * Chef deep-dive tools — the assistant's "tell me about this chef" reads. They wrap the
 * hardened Chef-360 domain readers (via the chef-profile read-model), so every number is
 * real and matches the admin chef page. Read-only, no confirmation. The brain resolves a
 * name to a chefId with chefs.find first, then drills in here.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { chefWorkSummary, chefFeedback } from "@/lib/ai/read-model/chef-profile";

export const chefsWorkSummary = defineTool({
  name: "chefs.work_summary",
  title: "Trackrecord van een chef",
  description:
    "Het werkelijke trackrecord van één chef: gewerkte uren, afgeronde + komende diensten, betrouwbaarheid (voorgesteld/geaccepteerd/afgewezen/geannuleerd/no-show), gemiddelde beoordeling, en bij welke klanten, segmenten en kantypes hij het meest werkt. Alleen echte cijfers (nooit verzonnen). Gebruik chefs.find voor het chefId.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({ chefId: z.string().min(1, "chefId is verplicht") }),
  run: async (input) => {
    const data = await chefWorkSummary(input.chefId);
    if (!data) throw new Error("deze chef bestaat niet (meer)");
    const rating =
      data.averageRating != null ? `${data.averageRating}★ (${data.ratingCount})` : "nog geen beoordeling";
    return {
      data,
      summary: `${data.chef.name}: ${data.totalHoursWorked} uur gewerkt over ${data.completedShifts} afgeronde dienst(en), ${data.upcomingShifts} komend, ${rating}.`,
    };
  },
});

export const chefsFeedback = defineTool({
  name: "chefs.feedback",
  title: "Beoordelingen van een chef",
  description:
    "De beoordelingen die klanten aan één chef gaven: sterren, tags en eventuele opmerkingen (de meest recente) plus de meest voorkomende tags. Intern — alleen jij ziet dit (ratings zijn intern in V1). Gebruik chefs.find voor het chefId.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({ chefId: z.string().min(1, "chefId is verplicht") }),
  run: async (input) => {
    const data = await chefFeedback(input.chefId);
    if (!data) throw new Error("deze chef bestaat niet (meer)");
    const summary =
      data.recent.length === 0
        ? `Nog geen beoordelingen voor ${data.chef.name}.`
        : `${data.recent.length} recente beoordeling(en) voor ${data.chef.name}${
            data.topTags.length ? ` — vaakst: ${data.topTags.slice(0, 3).map((t) => t.tag).join(", ")}` : ""
          }.`;
    return { data, summary };
  },
});
