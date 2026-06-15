/**
 * CHEF-PR10 — planned-vs-actual + client-overpromise tools (AI audit).
 *
 * Owner-only READ tools that turn the PR-4a clock-out reviews + planned-vs-actual
 * hours into answers: "which hotels overpromise?" and "where did shifts run over
 * this week?". Each wraps a read-model (overpromise.ts / clockout-signals.ts) that
 * returns LABELS, RATES and COUNTS only — never a raw issue note, never sensitive
 * values — so every number is evidence-cited (sample size N). Read-only.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { getOverpromiseByClient } from "@/lib/ai/read-model/overpromise";
import { getClockoutSignals } from "@/lib/ai/read-model/clockout-signals";
import { formatWorkedMinutes } from "@/lib/hours-labels";

export const clientsOverpromise = defineTool({
  name: "clients.overpromise",
  title: "Klanten die meer beloven dan ze waarmaken",
  description:
    "Welke klanten/hotels structureel afwijken van de afspraak: shifts die uitlopen, brief die niet klopte, gemiste pauzes, chefs die er niet terug willen. Per klant een score (0-100, hoger = erger) + onderbouwende cijfers (uitloop-%, off-brief-%, pauze-%, niet-terug-%) over de laatste ~90 dagen, met steekproefgrootte. Voor 'welke hotels overpromisen / waar lopen shifts steeds uit / waar willen chefs niet terug'. Alleen klanten met genoeg afgeronde shifts. Read-only, aggregaten — geen namen van chefs of vrije tekst.",
  risk: "read",
  permission: { resource: "clients", action: "read" },
  input: z.object({ windowDays: z.number().int().min(14).max(365).optional() }),
  run: async (input) => {
    const data = await getOverpromiseByClient(input.windowDays ?? 90);
    const pctStr = (n: number) => `${Math.round(n * 100)}%`;
    const summary =
      data.totalClients === 0
        ? `Geen klanten met genoeg afgeronde shifts (min. ${data.minSample}) in de laatste ${data.windowDays} dagen.`
        : `${data.totalClients} klant(en) gerangschikt op afwijking (${data.windowDays}d): ${data.clients
            .slice(0, 5)
            .map(
              (c) =>
                `${c.company ?? "onbekend"} (score ${c.score}, uitloop ${pctStr(c.overrunRate)}, n=${c.shifts})`,
            )
            .join(", ")}.`;
    return { data, summary };
  },
});

export const reportsPlannedVsActual = defineTool({
  name: "reports.planned_vs_actual",
  title: "Gepland vs. werkelijk — uitloop & aandachtspunten",
  description:
    "De recent afgeronde shifts (standaard laatste 36 uur) waar werkelijkheid afweek van de planning: uitloop in minuten + de clock-out-aandachtspunten (off-brief, geen pauze, extra uren, chef wil niet terug). Per shift de klant, geplande vs. gewerkte tijd en de redenen. Voor 'waar liepen shifts uit / wat ging er mis bij recente diensten / gepland versus werkelijk'. Read-only, geen vrije tekst.",
  risk: "read",
  permission: { resource: "cockpit", action: "read" },
  input: z.object({ windowHours: z.number().int().min(6).max(720).optional() }),
  run: async (input) => {
    const digest = await getClockoutSignals(input.windowHours ?? 36);
    // Trim to AVG-safe shape: labels + minute deltas, never the raw issue note.
    const items = digest.attention.map((a) => ({
      company: a.company,
      chef: a.chefName,
      plannedMinutes: a.plannedMinutes,
      actualMinutes: a.actualMinutes,
      overrunMinutes: a.overrunMinutes,
      reasons: a.reasons,
      hasNote: !!a.issueNote,
    }));
    const data = {
      windowHours: digest.windowHours,
      totalFinalised: digest.totalFinalised,
      counts: digest.counts,
      items,
    };
    const summary =
      items.length === 0
        ? `Geen afwijkingen bij ${digest.totalFinalised} afgeronde shift(s) in de laatste ${digest.windowHours} uur.`
        : `${items.length} shift(s) met aandachtspunt (${digest.windowHours}u): ${items
            .slice(0, 4)
            .map(
              (i) =>
                `${i.company ?? "een klant"} (${i.reasons[0] ?? `${formatWorkedMinutes(i.overrunMinutes)} uitloop`})`,
            )
            .join(", ")}.`;
    return { data, summary };
  },
});
