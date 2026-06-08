/**
 * Chef profile-change tools — see the queue of chef-submitted change requests, then
 * approve (applies the change to the chef's master record + e-mails the chef) or
 * reject (records the decision + e-mails the chef) one request. Both mutating tools
 * wrap the shared `decideChefProfileChange` domain function — the SAME core the admin
 * chef-detail page uses — so the AI's meta-audit pairs with the domain's business row
 * and the logic can never drift between the two surfaces. Confirm-gated (outbound):
 * every decision e-mails the chef.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { listPendingProfileChanges } from "@/lib/ai/read-model/profile-changes";
import {
  decideChefProfileChange,
  profileChangeErrorNl,
} from "@/lib/domain/chef-profile-changes";

export const chefsListProfileChanges = defineTool({
  name: "chefs.list_profile_changes",
  title: "Wijzigingsverzoeken van chefs",
  description:
    "Lijst van profielwijzigingen die chefs hebben aangevraagd (naam, e-mail, vakniveau of uurtarief) en die op jouw goedkeuring wachten. Read-only. Gebruik dit om het requestId te vinden vóór je goed- of afkeurt.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({}),
  run: async () => {
    const rows = await listPendingProfileChanges();
    const summary =
      rows.length === 0
        ? "Er wachten geen wijzigingsverzoeken op je goedkeuring."
        : `${rows.length} wijzigingsverzoek(en) wachten op je goedkeuring.`;
    return { data: { count: rows.length, requests: rows }, summary };
  },
});

export const chefsApproveProfileChange = defineTool({
  name: "chefs.approve_profile_change",
  title: "Wijzigingsverzoek goedkeuren",
  description:
    "Keurt één profielwijziging van een chef goed: de nieuwe waarde wordt direct doorgevoerd in het chef-profiel en de chef krijgt een bevestigingsmail. Gebruik chefs.list_profile_changes voor het requestId.",
  risk: "outbound",
  permission: { resource: "chefs", action: "write" },
  input: z.object({
    requestId: z.string().min(1, "requestId is verplicht"),
    notes: z.string().optional(),
  }),
  describeAction: (input) =>
    `Wijzigingsverzoek ${input.requestId} GOEDKEUREN — de wijziging wordt doorgevoerd in het chef-profiel en de chef krijgt bericht.`,
  run: async (input, ctx) => {
    const res = await decideChefProfileChange({
      requestId: input.requestId,
      decidedBy: ctx.actor.requestedByUserId,
      decision: "approved",
      decisionNotes: input.notes ?? null,
    });
    if (!res.ok) throw new Error(profileChangeErrorNl(res.reason));
    return {
      data: { requestId: input.requestId, decision: "approved", field: res.field },
      summary: `${res.fieldLabel} goedgekeurd voor ${res.chefName}${
        res.emailed ? " — de chef is per e-mail op de hoogte gebracht" : ""
      }.`,
    };
  },
});

export const chefsRejectProfileChange = defineTool({
  name: "chefs.reject_profile_change",
  title: "Wijzigingsverzoek afwijzen",
  description:
    "Wijst één profielwijziging van een chef af. Er verandert niets aan het profiel; de chef krijgt bericht (met je optionele toelichting). Gebruik chefs.list_profile_changes voor het requestId.",
  risk: "outbound",
  permission: { resource: "chefs", action: "write" },
  input: z.object({
    requestId: z.string().min(1, "requestId is verplicht"),
    notes: z.string().optional(),
  }),
  describeAction: (input) =>
    `Wijzigingsverzoek ${input.requestId} AFWIJZEN — het profiel blijft ongewijzigd en de chef krijgt bericht.`,
  run: async (input, ctx) => {
    const res = await decideChefProfileChange({
      requestId: input.requestId,
      decidedBy: ctx.actor.requestedByUserId,
      decision: "rejected",
      decisionNotes: input.notes ?? null,
    });
    if (!res.ok) throw new Error(profileChangeErrorNl(res.reason));
    return {
      data: { requestId: input.requestId, decision: "rejected", field: res.field },
      summary: `${res.fieldLabel}-verzoek van ${res.chefName} afgewezen${
        res.emailed ? " — de chef is op de hoogte gebracht" : ""
      }.`,
    };
  },
});
