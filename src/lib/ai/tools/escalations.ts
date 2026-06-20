/**
 * escalations.list — the open owner-side spoed-escalaties (P4/P5c). Read-only; surfaces
 * what the dashboard's red banner shows so the assistant can answer "welke spoedsituaties
 * lopen er / wat is urgent nu?". Labels/aggregates only — `reason` is the machine-built
 * Dutch one-liner, never chef free text (P4a guarantees that upstream).
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { emergencyModeEnabled, listOpenEscalations } from "@/lib/domain/emergencies";

const KIND_LABEL: Record<string, string> = {
  chef_cancelled_late: "chef trok zich laat terug",
  unassigned_soon: "binnenkort onbemand",
  unconfirmed_near_start: "niet bevestigd, start nabij",
  chef_signal: "urgent signaal van chef",
};

export const escalationsList = defineTool({
  name: "escalations.list",
  title: "Open spoedsituaties",
  description:
    "De open spoed-escalaties op het ops-dashboard: een chef die zich laat terugtrok, een dienst die binnenkort onbemand is, een niet-bevestigde dienst vlak voor de start, of een urgent signaal van een chef tijdens de dienst. Read-only. Voor 'welke spoedsituaties lopen er / wat is urgent nu / zijn er noodgevallen?'.",
  risk: "read",
  permission: { resource: "cockpit", action: "read" },
  input: z.object({}),
  run: async () => {
    const rows = await listOpenEscalations();
    const mode = emergencyModeEnabled();
    if (rows.length === 0) {
      return {
        data: { count: 0, escalations: [], emergencyMode: mode },
        summary: mode
          ? "Geen open spoedsituaties — alles onder controle. 👍"
          : "Geen open spoedsituaties. (Let op: emergency-mode staat uit, dus er wordt nu niet automatisch gedetecteerd.)",
      };
    }
    const escalations = rows.map((e) => ({
      soort: KIND_LABEL[e.kind] ?? e.kind,
      reden: e.reason,
      klant: e.companyName,
      dienstStart: e.shiftStartsAt,
    }));
    return {
      data: { count: rows.length, escalations, emergencyMode: mode },
      summary: `${rows.length} open spoedsituatie${rows.length === 1 ? "" : "s"}: ${rows
        .map((e) => `${e.companyName ?? "klant"} — ${KIND_LABEL[e.kind] ?? e.kind}`)
        .join("; ")}.`,
    };
  },
});
