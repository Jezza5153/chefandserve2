/**
 * Klant shift change/cancel request queue — read the owner's approval inbox, and decide a
 * request. Deciding wraps the tested `decideShiftChangeRequest` domain fn (atomic decision +
 * klant outcome email + notification; an approved CANCEL really cancels the shift). The decide
 * is confirm-gated and tier `financial` (it can cancel committed work → strong confirmation).
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { pendingShiftChangeRequestsForAi } from "@/lib/ai/read-model/client-requests";
import { decideShiftChangeRequest } from "@/lib/domain/shift-change-requests";

export const clientsShiftRequests = defineTool({
  name: "clients.shift_requests",
  title: "Klant-verzoeken (wijziging/annulering)",
  description:
    "Openstaande wijzigings- en annuleringsverzoeken van klanten op bevestigde diensten — per verzoek de klant, de dienst, het soort (wijziging/annulering), de reden en wanneer aangevraagd, eerstvolgende dienst eerst (urgentie). Voor 'welke klant-verzoeken wachten op mij / wil een hotel een dienst wijzigen of annuleren?'. Read-only. Beslis daarna met clients.decide_shift_request.",
  risk: "read",
  permission: { resource: "shifts", action: "read" },
  input: z.object({ limit: z.number().int().min(1).max(50).optional() }),
  run: async (input) => {
    const rows = await pendingShiftChangeRequestsForAi(input.limit ?? 20);
    const cancels = rows.filter((r) => r.soort === "annulering").length;
    return {
      data: { count: rows.length, requests: rows },
      summary:
        rows.length === 0
          ? "Geen openstaande klant-verzoeken."
          : `${rows.length} openstaand verzoek/verzoeken${cancels > 0 ? ` — ⚠ ${cancels} annulering(en)` : ""}.`,
    };
  },
});

export const clientsDecideShiftRequest = defineTool({
  name: "clients.decide_shift_request",
  title: "Klant-verzoek beslissen",
  description:
    "Keur een klant-wijzigings- of annuleringsverzoek goed of af, met een optionele toelichting. Bij een GOEDGEKEURDE annulering wordt de dienst daadwerkelijk geannuleerd (de geplaatste chef(s) ook). De klant krijgt automatisch bericht over de beslissing. Gebruik clients.shift_requests voor het requestId.",
  risk: "financial",
  permission: { resource: "shifts", action: "write" },
  input: z.object({
    requestId: z.string().min(1, "requestId is verplicht"),
    decision: z.enum(["approved", "rejected"]),
    decisionNotes: z.string().optional(),
  }),
  describeAction: (i) =>
    `Klant-verzoek ${i.requestId} ${i.decision === "approved" ? "GOEDKEUREN" : "AFWIJZEN"}${i.decisionNotes ? ` — toelichting: "${i.decisionNotes}"` : ""}. De klant krijgt automatisch bericht${i.decision === "approved" ? "; als het een annulering is, wordt de dienst geannuleerd." : "."}`,
  run: async (input, ctx) => {
    const res = await decideShiftChangeRequest({
      requestId: input.requestId,
      decidedBy: ctx.actor.requestedByUserId,
      decision: input.decision,
      decisionNotes: input.decisionNotes ?? null,
    });
    if (!res.ok) {
      throw new Error(res.error === "not_found" ? "dit verzoek bestaat niet (meer)" : `kon het verzoek niet verwerken (${res.error})`);
    }
    return {
      data: { requestId: input.requestId, decision: input.decision },
      summary: `Verzoek ${input.decision === "approved" ? "goedgekeurd" : "afgewezen"} — de klant is op de hoogte gebracht.`,
    };
  },
});
