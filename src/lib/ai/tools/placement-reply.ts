/**
 * placements.reply — post a comment into a placement's thread (the klant hub's source of truth),
 * as the owner. visibility 'client_visible' reaches the klant on their shift page; 'internal' is
 * a staff-only note. Wraps the tested addPlacementComment (the ONLY correct way to write a
 * multi-actor comment — never placements.notes). Confirm-gated (klant-facing content).
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { addPlacementComment } from "@/lib/domain/comments";

export const placementsReply = defineTool({
  name: "placements.reply",
  title: "Reageren bij een plaatsing (klant-hub)",
  description:
    "Plaats een bericht in de gesprekslijn van een plaatsing — namens Chef & Serve. Met visibility 'client_visible' ziet de klant het op de dienstpagina (gebruik dit om op een klant te reageren of iets te laten weten); met 'internal' is het een interne notitie voor je team. Voor 'reageer naar hotel X dat … / laat de klant weten dat …'. Gebruik shifts.detail voor het placementId (staat per teamlid).",
  risk: "outbound",
  permission: { resource: "shifts", action: "write" },
  input: z.object({
    placementId: z.string().min(1, "placementId is verplicht"),
    body: z.string().min(1, "bericht mag niet leeg zijn").max(1000, "max. 1000 tekens"),
    visibility: z.enum(["client_visible", "internal"]).optional(),
  }),
  describeAction: (i) => {
    const vis = (i.visibility ?? "client_visible") === "client_visible" ? "ZICHTBAAR VOOR DE KLANT" : "intern (alleen je team)";
    return `Bericht plaatsen bij plaatsing ${i.placementId} (${vis}):\n"${i.body}"`;
  },
  run: async (input, ctx) => {
    const res = await addPlacementComment({
      placementId: input.placementId,
      authorUserId: ctx.actor.requestedByUserId,
      authorKind: "admin",
      visibility: input.visibility ?? "client_visible",
      body: input.body,
    });
    if (!res.ok) {
      const msg =
        res.error === "empty" ? "het bericht is leeg" : res.error === "too-long" ? "het bericht is te lang (max. 1000 tekens)" : "kon het bericht niet plaatsen";
      throw new Error(msg);
    }
    return {
      data: { id: res.id },
      summary: `Bericht geplaatst${(input.visibility ?? "client_visible") === "client_visible" ? " — de klant kan het zien op de dienstpagina" : " (intern)"}.`,
    };
  },
});
