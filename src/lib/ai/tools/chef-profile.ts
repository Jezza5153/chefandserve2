/**
 * Chef deep-dive tools — the assistant's "tell me about this chef" reads. They wrap the
 * hardened Chef-360 domain readers (via the chef-profile read-model), so every number is
 * real and matches the admin chef page. Read-only, no confirmation. The brain resolves a
 * name to a chefId with chefs.find first, then drills in here.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import {
  chefWorkSummary,
  chefFeedback,
  chefTrends,
  chefProfileCompleteness,
} from "@/lib/ai/read-model/chef-profile";

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

export const chefsTrends = defineTool({
  name: "chefs.trends",
  title: "Trend & churn-risico van een chef",
  description:
    "Hoe een chef zich de laatste weken ontwikkelt: churn-risico (geen/laag/let-op/verhoogd) met concrete redenen, dagen sinds laatst gewerkt, acceptatiegraad + gemiddelde beoordeling (28d), en week-op-week verandering in uren/marge/diensten. Deterministisch en uitlegbaar — nooit een verzonnen score. Gebruik chefs.find voor het chefId.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({ chefId: z.string().min(1, "chefId is verplicht") }),
  run: async (input) => {
    const data = await chefTrends(input.chefId);
    if (!data) throw new Error("deze chef bestaat niet (meer)");
    const churnNl: Record<string, string> = {
      none: "geen signaal",
      low: "laag",
      watch: "let op",
      elevated: "verhoogd",
    };
    return {
      data,
      summary: `${data.chef.name}: churn-risico ${churnNl[data.churn.level] ?? data.churn.level}${
        data.churn.reasons.length ? ` (${data.churn.reasons.join(", ")})` : ""
      }.`,
    };
  },
});

export const chefsProfileCompleteness = defineTool({
  name: "chefs.profile_completeness",
  title: "Profielvolledigheid van een chef",
  description:
    "Hoe compleet een chef-profiel is: score (0-100) + label (compleet/bruikbaar/mist data/onbruikbaar) + welke kritieke en optionele velden ontbreken (vakniveau, stad, tarief, contact, segmenten, ervaring, ...). Handig om te zien waarom een chef nog niet goed te matchen of voor te stellen is. Gebruik chefs.find voor het chefId.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({ chefId: z.string().min(1, "chefId is verplicht") }),
  run: async (input) => {
    const data = await chefProfileCompleteness(input.chefId);
    if (!data) throw new Error("deze chef bestaat niet (meer)");
    const miss = data.missingCritical.length ? ` Mist nog: ${data.missingCritical.join(", ")}.` : "";
    return { data, summary: `${data.chef.name}: profiel ${data.score}% (${data.label}).${miss}` };
  },
});
