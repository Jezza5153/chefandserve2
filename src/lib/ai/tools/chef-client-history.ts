/**
 * chefs.history_at_client — the track record of one chef at one client, for the placement
 * decision. Owner-only (ratings are internal V1; the chef/klant PAs don't get this tool).
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { chefHistoryAtClientForAi } from "@/lib/ai/read-model/chef-client-history";

export const chefsHistoryAtClient = defineTool({
  name: "chefs.history_at_client",
  title: "Chef-historie bij een klant",
  description:
    "De staat van dienst van één chef bij één specifieke klant: hoe vaak eerder gewerkt, in welke rollen, wanneer voor het laatst, no-shows/annuleringen, en de interne beoordeling (gemiddelde ster + tags + opmerkingen) — PLUS de historie uit het oude systeem (gewerkte uren, uitnodigingen en de beoordeling op hun 1..10-schaal), want voor de overgezette chefs staat dáár hun hele trackrecord. Voor de plaatsingsbeslissing: 'zal ik chef X wéér naar klant Y sturen / hoe ging het de vorige keren?'. Read-only — beoordelingen zijn intern. Gebruik chefs.find + clients.find voor de id's.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({
    chefId: z.string().min(1, "chefId is verplicht"),
    clientId: z.string().min(1, "clientId is verplicht"),
  }),
  run: async (input) => {
    const d = await chefHistoryAtClientForAi(input.chefId, input.clientId);
    if (!d) throw new Error("deze chef of klant bestaat niet (meer)");
    // The oude-systeem line comes FIRST when we have no placements of our own: answering
    // "nog niet eerder gewerkt" about a chef with duizenden uren daar is the exact
    // confidently-wrong failure this data was migrated to prevent.
    const oud = d.oudeSysteem;
    const oudTxt = oud
      ? `In het oude systeem: ±${oud.urenGewerkt} uur over ${oud.uitnodigingen} uitnodigingen, beoordeling ${oud.beoordeling}.${oud.let_op ? ` ${oud.let_op}` : ""}`
      : "";
    const summary =
      d.keerGewerkt === 0
        ? oud
          ? `${d.chef} werkte in DIT systeem nog niet bij ${d.klant}, maar wél daarvoor. ${oudTxt}`
          : `${d.chef} heeft nog niet eerder bij ${d.klant} gewerkt.`
        : `${d.chef} werkte ${d.keerGewerkt}× bij ${d.klant}${d.laatst ? ` (laatst ${d.laatst})` : ""}, ${d.gemiddeldeBeoordeling}${d.noShows > 0 ? ` — ⚠ ${d.noShows} no-show(s)` : ""}.${oud ? ` ${oudTxt}` : ""}`;
    return { data: d, summary };
  },
});
