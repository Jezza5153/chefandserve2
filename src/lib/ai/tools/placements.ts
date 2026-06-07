/**
 * Placement tools. `placements.propose` composes the same tested primitives the admin
 * shift page uses (proposePlacement → audit → recomputeShiftStatus) rather than
 * re-implementing or rewiring the page — safe, no extraction. Confirm-gated because it
 * emails the chef an invitation.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { recordAuditCore } from "@/lib/audit";
import { proposePlacement } from "@/lib/domain/matching";
import { recomputeShiftStatus } from "@/lib/domain/shift-status";

export const placementsPropose = defineTool({
  name: "placements.propose",
  title: "Chef voorstellen voor dienst",
  description:
    "Stelt een chef voor aan een dienst: maakt een placement aan en mailt de chef de uitnodiging. De chef accepteert daarna zelf; jij bevestigt later.",
  risk: "outbound",
  permission: { resource: "shifts", action: "write" },
  input: z.object({
    shiftId: z.string().min(1, "shiftId is verplicht"),
    chefId: z.string().min(1, "chefId is verplicht"),
    matchScore: z.number().int().min(0).max(100).optional(),
  }),
  describeAction: (input) => `Chef ${input.chefId} voorstellen voor dienst ${input.shiftId}.`,
  run: async (input, ctx) => {
    const { placementId, status } = await proposePlacement(input.shiftId, input.chefId, {
      proposedBy: ctx.actor.requestedByUserId,
      ...(input.matchScore != null ? { matchScore: input.matchScore } : {}),
    });
    if (status === "already_proposed") {
      return { data: { id: placementId, status }, summary: "Deze chef is al voorgesteld voor deze dienst." };
    }
    await recordAuditCore({
      userId: ctx.actor.paServiceUserId,
      action: "placements.propose",
      resource: "placements",
      resourceId: placementId,
      after: { shiftId: input.shiftId, chefId: input.chefId, matchScore: input.matchScore ?? null },
    });
    await recomputeShiftStatus(input.shiftId);
    return { data: { id: placementId, status }, summary: "Chef voorgesteld — de chef heeft een uitnodiging gekregen." };
  },
});
