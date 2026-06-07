/**
 * Operational read tools — the assistant's wider "eyes" over the live business.
 * All read-only (no confirm), each gated on a real RBAC catalog key.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { getPlannerCockpit } from "@/lib/domain/planner-intel";
import { getLeaderboards } from "@/lib/domain/leaderboards";
import { getIntegrationHealth } from "@/lib/integrations";

export const shiftsOpenSoon = defineTool({
  name: "shifts.open_soon",
  title: "Open diensten binnenkort",
  description:
    "Diensten met open plekken binnen 48 uur (plus het aantal open binnen 7 dagen) en geaccepteerd-maar-niet-bevestigd. Voor 'wat staat er nog open?'.",
  risk: "read",
  permission: { resource: "shifts", action: "read" },
  input: z.object({}),
  run: async () => {
    const c = await getPlannerCockpit();
    const summary =
      c.open48hSlots === 0
        ? `Geen open plekken binnen 48 uur. ${c.open7dCount} open binnen 7 dagen.`
        : `${c.open48hSlots} open plek(ken) binnen 48u over ${c.open48h.length} dienst(en); ${c.open7dCount} open binnen 7 dagen; ${c.acceptedUnconfirmed} geaccepteerd maar niet bevestigd.`;
    return {
      data: {
        open48h: c.open48h,
        open48hSlots: c.open48hSlots,
        open7dCount: c.open7dCount,
        acceptedUnconfirmed: c.acceptedUnconfirmed,
      },
      summary,
    };
  },
});

export const insightsLeaderboards = defineTool({
  name: "insights.leaderboards",
  title: "Ranglijsten (chefs & klanten)",
  description:
    "Top-chefs en -klanten over een periode: meeste verdiend, drukst, betrouwbaarst, hoogst gewaardeerd, en topklanten. Voor 'wie zijn m'n beste chefs?'.",
  risk: "read",
  permission: { resource: "cockpit", action: "read" },
  input: z.object({ windowDays: z.number().int().positive().max(365).optional() }),
  run: async (input) => {
    const lb = await getLeaderboards(input.windowDays ?? 90);
    const top = lb.topEarners[0];
    const summary = top
      ? `Top-chef (${lb.windowDays}d): ${top.name} — ${top.display}. Plus ranglijsten voor drukst, betrouwbaarst en hoogst gewaardeerd.`
      : `Nog geen ranglijst-data over de afgelopen ${lb.windowDays} dagen.`;
    return { data: lb, summary };
  },
});

export const integrationsHealth = defineTool({
  name: "integrations.health",
  title: "Integratie-gezondheid",
  description:
    "Status van de uitgaande koppelingen: outbox-wachtrij + fouten, e-mailaflevering en bounces (7 dagen). Voor 'draait alles goed?'.",
  risk: "read",
  permission: { resource: "integrations", action: "read" },
  input: z.object({}),
  run: async () => {
    const h = await getIntegrationHealth();
    const healthy = h.outboxFailed === 0 && h.emailBouncesLast7d === 0;
    const summary = healthy
      ? `Alles gezond: ${h.outboxPending} in de outbox-wachtrij, 0 fouten, ${h.emailDeliveredLast7d}/${h.emailTotalLast7d} e-mails afgeleverd (7d).`
      : `Let op — ${h.outboxFailed} outbox-fout(en) en ${h.emailBouncesLast7d} bounce(s) in de afgelopen 7 dagen.`;
    return { data: h, summary };
  },
});
