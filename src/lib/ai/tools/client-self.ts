/**
 * KLANT portal assistant tools — read-only, own-data-only. Same safety model as the chef tools:
 * `permission:null` + `risk:"read"`, every query keyed off `ctx.actor.subject.entityId` (the
 * klant resolved from the session), never a model-supplied id.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import type { ToolContext } from "@/lib/ai/types";
import { clientMyShifts, clientMyHours, clientMyRequests, clientMyTemplates } from "@/lib/ai/read-model/client-self";

function requireClientId(ctx: ToolContext): string {
  if (ctx.actor.subject?.kind !== "client" || !ctx.actor.subject.entityId) {
    throw new Error("Geen gekoppeld klant-profiel.");
  }
  return ctx.actor.subject.entityId;
}

export const clientMyShiftsTool = defineTool({
  name: "onze.diensten",
  title: "Onze diensten",
  description:
    "Jullie geplande diensten: deze week (chef, rol, wanneer, status) plus het aantal bevestigde komende diensten. Read-only — alleen jullie eigen diensten.",
  risk: "read",
  permission: null,
  input: z.object({}),
  run: async (_input, ctx) => {
    const data = await clientMyShifts(requireClientId(ctx));
    return {
      data,
      summary: `${data.thisWeek.length} dienst(en) deze week · ${data.upcomingConfirmed} bevestigd komend.`,
    };
  },
});

export const clientMyHoursTool = defineTool({
  name: "onze.uren",
  title: "Uren te tekenen",
  description:
    "Uurbriefjes die op jullie akkoord wachten (chef + wanneer), plus de besteding van de afgelopen 30 dagen. Read-only — alleen jullie eigen uren.",
  risk: "read",
  permission: null,
  input: z.object({}),
  run: async (_input, ctx) => {
    const data = await clientMyHours(requireClientId(ctx));
    return {
      data,
      summary: `${data.toSign.length} uurbriefje(s) te tekenen · besteed 30 dagen ${data.spend30dEur}.`,
    };
  },
});

export const clientMyTemplatesTool = defineTool({
  name: "onze.vaste_diensten",
  title: "Onze vaste diensten",
  description:
    "Jullie terugkerende/vaste diensten (templates): rol, aantal en patroon (bijv. 'Elke maandag · 18:00–23:00'). Read-only — alleen jullie eigen vaste diensten.",
  risk: "read",
  permission: null,
  input: z.object({}),
  run: async (_input, ctx) => {
    const data = await clientMyTemplates(requireClientId(ctx));
    return {
      data,
      summary:
        data.templates.length === 0
          ? "Jullie hebben geen vaste diensten lopen."
          : `${data.templates.length} vaste dienst(en): ${data.templates.map((t) => `${t.role} (${t.pattern})`).join("; ")}.`,
    };
  },
});

export const clientMyRequestsTool = defineTool({
  name: "onze.aanvragen",
  title: "Onze aanvragen & feedback",
  description:
    "Openstaande aanvragen die nog op planning wachten, en chefs die op jullie feedback wachten. Read-only — alleen jullie eigen aanvragen.",
  risk: "read",
  permission: null,
  input: z.object({}),
  run: async (_input, ctx) => {
    const data = await clientMyRequests(requireClientId(ctx));
    return {
      data,
      summary: `${data.openRequests.length} openstaande aanvraag(en) · ${data.awaitingFeedback.length} chef(s) wachten op feedback.`,
    };
  },
});
