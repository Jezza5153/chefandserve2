/**
 * Inbound-comms tool — "wat is er binnengekomen?". Read-only, and INBOX-SCOPED to the asking
 * human: the assistant inherits exactly the inbox-access mapping (/admin/system/inboxen) of
 * whoever is chatting — a planner's AI never surfaces the owners' mailboxes; owners see per
 * their own grants (+ stray mail); super_admin sees everything. Returns sender + subject +
 * classification + inbox label — NEVER the raw body (untrusted content stays out of the
 * model's context; open the mail itself for the full text).
 */
import { z } from "zod";

import { listRecentInbound } from "@/lib/domain/inbound";
import { listInboxLabels, viewerInboxFilter } from "@/lib/domain/inboxes";
import { defineTool } from "@/lib/ai/tools/registry";

export const inboundList = defineTool({
  name: "inbound.list",
  title: "Binnengekomen berichten",
  description:
    "Wat is er per e-mail BINNENGEKOMEN (onze gevangen inboxen)? Geeft afzender, onderwerp, classificatie (⚠ klacht / ⏱ spoed / vraag / overig) en de inbox waar het in viel, nieuwste eerst. Je ziet ALLEEN de inboxen waar de vrager toegang toe heeft (inbox-toegangsbeheer). Optioneel `unhandledOnly` en `limit`. Read-only; toont bewust NIET de berichttekst — afzenderinhoud is onbetrouwbaar.",
  risk: "read",
  permission: { resource: "clients", action: "read" },
  input: z.object({
    unhandledOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  run: async (input, ctx) => {
    // The assistant's inbox view = the asking human's inbox view. Same policy as Berichten.
    const role = ctx.actor.requestedByRole;
    const [viewer, inboxLabels] = await Promise.all([
      viewerInboxFilter(ctx.actor.requestedByUserId, {
        superAdmin: role === "super_admin",
        owner: role === "owner" || role === "super_admin",
      }),
      listInboxLabels(),
    ]);
    const items = await listRecentInbound({
      unhandledOnly: input.unhandledOnly,
      limit: input.limit,
      viewer,
      inboxLabels,
    });
    if (items.length === 0) {
      return {
        data: { count: 0, items: [] },
        summary: "Geen binnengekomen berichten (binnen de inboxen waar je toegang toe hebt).",
      };
    }
    const flagged = items.filter((i) => i.category === "complaint" || i.category === "urgent");
    const head = items
      .slice(0, 5)
      .map((i) => {
        const mark = i.category === "complaint" ? "⚠ " : i.category === "urgent" ? "⏱ " : "";
        const who = i.from.split("<")[0].trim() || i.from;
        return `${mark}${who}${i.subject ? ` — "${i.subject}"` : ""}${i.inbox ? ` [${i.inbox}]` : ""}`;
      })
      .join("; ");
    return {
      data: { count: items.length, flagged: flagged.length, items },
      summary: `${items.length} bericht(en)${flagged.length ? `, waarvan ${flagged.length} klacht/spoed` : ""}: ${head}${items.length > 5 ? " …" : ""}.`,
    };
  },
});
