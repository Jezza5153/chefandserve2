/**
 * Read tools over the business read-model. No side effects → risk "read", no confirm.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { getBusinessSnapshot } from "@/lib/ai/read-model/business";

export const businessOverview = defineTool({
  name: "business.overview",
  title: "Bedrijfsoverzicht",
  description:
    "Actueel bedrijfsoverzicht: omzet en marge (week/maand/YTD), bezetting, actieve chefs, en operationele aandachtspunten (open diensten binnen 48u, geaccepteerd-niet-bevestigd, intake).",
  risk: "read",
  permission: null, // the owner's own aggregate dashboard; the channel already gates to the owner
  input: z.object({}),
  run: async () => {
    const snap = await getBusinessSnapshot();
    return { data: snap, summary: snap.headline };
  },
});
