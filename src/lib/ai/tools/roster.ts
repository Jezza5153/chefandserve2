/**
 * Roster overview tool — the assistant's staffing picture. Runs the SAME
 * buildRosterView + rosterAiSummary engine the cockpit screen uses (via the read-model),
 * so the AI's answer matches /admin/business/roster exactly. Read-only.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { loadRosterAiSummary } from "@/lib/ai/read-model/roster";

export const rosterOverview = defineTool({
  name: "roster.overview",
  title: "Bezetting / staffing-overzicht",
  description:
    "Het rooster-/bezettingsoverzicht voor deze week, volgende week of deze maand: open plekken, kritieke diensten, het drukste dagdeel, hotels die aandacht vragen, en open-binnen-48u. Dezelfde cijfers als het cockpit-scherm. Read-only.",
  risk: "read",
  permission: { resource: "roster", action: "read" },
  input: z.object({
    period: z.enum(["this_week", "next_week", "this_month"]).optional(),
  }),
  run: async (input, ctx) => {
    const period = input.period ?? "this_week";
    const res = await loadRosterAiSummary({
      period,
      userId: ctx.actor.requestedByUserId,
      now: new Date(),
    });
    return {
      data: { period, ...res.facts },
      summary: res.text || "Geen diensten in deze periode.",
    };
  },
});
