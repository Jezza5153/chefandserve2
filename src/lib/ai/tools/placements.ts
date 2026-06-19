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
import { completePlacement } from "@/lib/domain/hours-admin";

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
    const result = await proposePlacement(input.shiftId, input.chefId, {
      proposedBy: ctx.actor.requestedByUserId,
      ...(input.matchScore != null ? { matchScore: input.matchScore } : {}),
    });
    // P3a: a blocked chef is NOT proposable from the AI path — the tool can't supply an
    // override (no field in its input schema), so the model can never bypass compliance.
    // Surface PII-free Dutch labels only.
    if (result.status === "blocked") {
      return {
        data: { status: "blocked", blockers: result.blockers },
        summary:
          "Niet voorgesteld — deze chef is op dit moment niet inzetbaar: " +
          result.blockers.join(", ") +
          ". Een mens moet dit met reden vrijgeven; ik kan dat niet zelf.",
      };
    }
    const { placementId, status } = result;
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
      expectedStatus: "accepted", // the description promises accepted-only; enforce it atomically
    });
    // P3a-2: a compliance-blocked chef can't be confirmed from the AI path — the tool
    // has no override field, so the model can't bypass. Surface PII-free Dutch labels.
    if (!res.ok && res.reason === "blocked") {
      return {
        data: { id: input.placementId, status: "blocked", blockers: res.blockers ?? [] },
        summary:
          "Niet bevestigd — deze chef is niet inzetbaar: " +
          (res.blockers ?? []).join(", ") +
          ". Een mens moet dit met reden vrijgeven; ik kan dat niet zelf.",
      };
    }
    if (!res.ok) throw new Error(res.reason);
    if (!res.changed) {
      return { data: { id: input.placementId, changed: false }, summary: "Niet bevestigd — deze plaatsing is niet (meer) in status 'geaccepteerd' (al bevestigd, afgewezen of geannuleerd)." };
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

export const placementsComplete = defineTool({
  name: "placements.complete",
  title: "Plaatsing afronden",
  description:
    "Markeert een BEVESTIGDE, al gewerkte plaatsing als afgerond (→ completed) en zet er een concept-urenregel voor klaar — dit boekt de dienst als gedraaid (loon/factuur volgt). Werkt alleen op een bevestigde plaatsing waarvan de dienst al voorbij is; gebruik shifts.detail om het placementId + de status te checken. Daarna logt de chef de uren.",
  risk: "financial",
  permission: { resource: "shifts", action: "write" },
  input: z.object({ placementId: z.string().min(1, "placementId is verplicht") }),
  describeAction: (input) => `Plaatsing ${input.placementId} afronden — boekt de dienst als gedraaid + zet een concept-urenregel klaar.`,
  run: async (input, ctx) => {
    const res = await completePlacement({ placementId: input.placementId, actorUserId: ctx.actor.requestedByUserId });
    if (!res.ok) {
      const reason =
        res.reason === "not-confirmed"
          ? "deze plaatsing is niet (meer) bevestigd — alleen een bevestigde, gewerkte dienst kun je afronden"
          : res.reason === "not-ended"
            ? "de dienst is nog niet voorbij — je kunt 'm pas afronden ná afloop"
            : "de dienst heeft geen gekoppelde klant";
      return { data: { id: input.placementId, ok: false, reason: res.reason }, summary: `Niet afgerond — ${reason}.` };
    }
    return {
      data: { id: input.placementId, ok: true, hoursId: res.hoursId },
      summary: "Plaatsing afgerond — er staat nu een concept-urenregel klaar om in te dienen.",
    };
  },
});
