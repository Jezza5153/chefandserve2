/**
 * Client deep-dive tool — "tell me about this klant". Wraps the klant-360 read-model
 * (hardened getClientSummary). Read-only. Brain resolves a name to a clientId with
 * clients.find first, then drills in here.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { clientHistory } from "@/lib/ai/read-model/clients";
import { getClientHealth } from "@/lib/domain/client-history";

export const clientsHistory = defineTool({
  name: "clients.history",
  title: "Klant-overzicht (360)",
  description:
    "Het volledige beeld van één klant: diensten (totaal/afgerond/open/komend), bezettingsgraad, gewerkte uren, besteed bedrag + marge (EUR), vaste vs losse chefs + top-chefs, gegeven beoordelingen, en aftekensnelheid + uren die nog op hun handtekening wachten. Alleen echte cijfers. Gebruik clients.find voor het clientId.",
  risk: "read",
  permission: { resource: "clients", action: "read" },
  input: z.object({ clientId: z.string().min(1, "clientId is verplicht") }),
  run: async (input) => {
    const data = await clientHistory(input.clientId);
    if (!data) throw new Error("deze klant bestaat niet (meer)");
    return {
      data,
      summary: `${data.client.name}: ${data.completedShifts} afgeronde dienst(en), €${data.spendEur.toLocaleString("nl-NL")} besteed, ${data.distinctChefs} chef(s)${
        data.pendingSignoff > 0 ? `, ${data.pendingSignoff} uren wachten op handtekening` : ""
      }.`,
    };
  },
});

export const clientsHealth = defineTool({
  name: "clients.health",
  title: "Is dit een goede klant? (verdict)",
  description:
    "Een glanceable 'goede klant?'-oordeel voor één klant: sterk / goed / vraagt aandacht, met sterke punten (volume, marge, vaste chefs, snel tekenen) en aandachtspunten (negatieve marge, openstaande handtekeningen, traag tekenen, geen nieuwe diensten, geen feedback). Gebruik clients.find voor het clientId. Read-only.",
  risk: "read",
  permission: { resource: "clients", action: "read" },
  input: z.object({ clientId: z.string().min(1, "clientId is verplicht") }),
  run: async (input) => {
    const data = await getClientHealth(input.clientId);
    if (!data) throw new Error("deze klant bestaat niet (meer)");
    const v = data.verdict;
    return {
      data: { verdict: v, signals: { completedShifts: data.summary.completedShifts, marginCents: data.summary.marginCents, pendingSignoff: data.summary.pendingSignoff } },
      summary:
        `${v.headline}. ${v.summary}` +
        (v.watchpoints.length ? ` Aandacht: ${v.watchpoints.join("; ")}.` : "") +
        (v.strengths.length ? ` Sterk: ${v.strengths.join("; ")}.` : ""),
    };
  },
});
