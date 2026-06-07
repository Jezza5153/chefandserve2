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
import { transitionPlacement } from "@/lib/domain/placement-transition";

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

export const placementsConfirm = defineTool({
  name: "placements.confirm",
  title: "Plaatsing bevestigen",
  description:
    "Bevestigt een geaccepteerde plaatsing (→ confirmed). Chef en klant krijgen een bevestigingsmail. Werkt niet op een al afgeronde of geannuleerde plaatsing.",
  risk: "financial",
  permission: { resource: "shifts", action: "write" },
  input: z.object({ placementId: z.string().min(1, "placementId is verplicht") }),
  describeAction: (input) => `Plaatsing ${input.placementId} bevestigen (chef + klant krijgen bericht).`,
  run: async (input, ctx) => {
    const res = await transitionPlacement({
      placementId: input.placementId,
      newStatus: "confirmed",
      actorUserId: ctx.actor.requestedByUserId,
    });
    if (!res.ok) throw new Error(res.reason);
    if (!res.changed) {
      return { data: { id: input.placementId, changed: false }, summary: "Niet bevestigd — deze plaatsing is al afgerond of geannuleerd." };
    }
    return { data: { id: input.placementId, changed: true }, summary: "Plaatsing bevestigd — chef en klant zijn op de hoogte gebracht." };
  },
});

export const placementsCancel = defineTool({
  name: "placements.cancel",
  title: "Plaatsing annuleren",
  description:
    "Annuleert een plaatsing (ONOMKEERBAAR). De dienst komt weer (deels) open te staan. Werkt niet op een al afgeronde of geannuleerde plaatsing.",
  risk: "financial",
  permission: { resource: "shifts", action: "write" },
  input: z.object({ placementId: z.string().min(1, "placementId is verplicht") }),
  describeAction: (input) => `Plaatsing ${input.placementId} ANNULEREN — dit is onomkeerbaar.`,
  run: async (input, ctx) => {
    const res = await transitionPlacement({
      placementId: input.placementId,
      newStatus: "cancelled",
      actorUserId: ctx.actor.requestedByUserId,
    });
    if (!res.ok) throw new Error(res.reason);
    if (!res.changed) {
      return { data: { id: input.placementId, changed: false }, summary: "Niet geannuleerd — deze plaatsing is al afgerond of geannuleerd." };
    }
    return { data: { id: input.placementId, changed: true }, summary: "Plaatsing geannuleerd." };
  },
});
