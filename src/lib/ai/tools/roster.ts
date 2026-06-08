/**
 * Roster overview tool — the assistant's staffing picture. Runs the SAME
 * buildRosterView + rosterAiSummary engine the cockpit screen uses (via the read-model),
 * so the AI's answer matches /admin/business/roster exactly. Read-only.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { loadRosterAiSummary } from "@/lib/ai/read-model/roster";
import { autofillWeek } from "@/lib/domain/roster-autofill";
import { publishDraftsForPeriod } from "@/lib/domain/roster-publish";
import {
  addDaysToKey,
  amsterdamDayKey,
  getAmsterdamMonthGrid,
  getAmsterdamWeekRange,
} from "@/lib/roster-format";

export const rosterOverview = defineTool({
  name: "roster.overview",
  title: "Bezetting / staffing-overzicht",
  description:
    "Het rooster-/bezettingsoverzicht voor vandaag, deze week, volgende week of deze maand: open plekken, kritieke diensten, het drukste dagdeel, hotels die aandacht vragen, en open-binnen-48u. Bij 'today' ook hoeveel passende chefs vandaag nog beschikbaar (niet ingepland) zijn — handig voor 'wie kan ik vandaag nog inzetten?'. Dezelfde cijfers als het cockpit-scherm. Read-only.",
  risk: "read",
  permission: { resource: "roster", action: "read" },
  input: z.object({
    period: z.enum(["today", "this_week", "next_week", "this_month"]).optional(),
  }),
  run: async (input, ctx) => {
    const period = input.period ?? "this_week";
    const res = await loadRosterAiSummary({
      period,
      userId: ctx.actor.requestedByUserId,
      now: new Date(),
    });
    return {
      data: { period, ...res.facts },
      summary: res.text || "Geen diensten in deze periode.",
    };
  },
});

/** Period → Amsterdam UTC range, mirroring loadRosterAiSummary so publish + overview agree. */
function periodRange(
  period: "this_week" | "next_week" | "this_month",
  now: Date,
): { startUtc: Date; endUtc: Date; label: string } {
  const todayKey = amsterdamDayKey(now);
  if (period === "this_month") {
    const m = getAmsterdamMonthGrid(todayKey);
    return { startUtc: m.startUtc, endUtc: m.endUtc, label: "deze maand" };
  }
  const anchor = period === "next_week" ? addDaysToKey(todayKey, 7) : todayKey;
  const w = getAmsterdamWeekRange(anchor);
  return {
    startUtc: w.startUtc,
    endUtc: w.endUtc,
    label: period === "next_week" ? "volgende week" : "deze week",
  };
}

export const rosterPublish = defineTool({
  name: "roster.publish",
  title: "Concept-rooster publiceren",
  description:
    "Publiceert alle CONCEPT-plaatsingen (drafts) voor een periode: elke chef krijgt zijn uitnodiging en elke klant ziet de voorgestelde chef. Concepten die intussen niet meer kunnen (chef geblokkeerd of dubbel geboekt) worden overgeslagen en teruggemeld. Daarna accepteren de chefs zelf en bevestig jij.",
  risk: "outbound",
  permission: { resource: "shifts", action: "write" },
  input: z.object({
    period: z.enum(["this_week", "next_week", "this_month"]).optional(),
  }),
  describeAction: (input) => {
    const p = input.period ?? "this_week";
    const nl = p === "next_week" ? "volgende week" : p === "this_month" ? "deze maand" : "deze week";
    return `Concept-rooster voor ${nl} publiceren — chefs krijgen een uitnodiging en klanten zien hun rooster.`;
  },
  run: async (input, ctx) => {
    const period = input.period ?? "this_week";
    const { startUtc, endUtc, label } = periodRange(period, new Date());
    const res = await publishDraftsForPeriod({
      startUtc,
      endUtc,
      actorUserId: ctx.actor.requestedByUserId,
    });
    const skippedLine =
      res.skipped.length > 0
        ? ` ${res.skipped.length} overgeslagen (${res.skipped
            .map((s) => `${s.chefName}: ${s.reason === "blocked" ? "geblokkeerd" : "dubbel geboekt"}`)
            .join("; ")}).`
        : "";
    return {
      data: { period, ...res },
      summary:
        res.total === 0
          ? `Geen concepten om te publiceren voor ${label}.`
          : `${res.published} van ${res.total} concept(en) gepubliceerd voor ${label} — chefs en klanten zijn bericht.${skippedLine}`,
    };
  },
});

export const rosterAutofill = defineTool({
  name: "roster.autofill",
  title: "Rooster automatisch vullen (concepten)",
  description:
    "Vult de open plekken in het rooster voor een periode automatisch met CONCEPTEN: de best passende beschikbare chef komt op elke open plek (geen dubbele boekingen, eerlijk verdeeld). De concepten zijn nog NIET gepubliceerd — niemand krijgt bericht; jij controleert ze op het planbord en publiceert daarna zelf met roster.publish.",
  risk: "outbound",
  permission: { resource: "shifts", action: "write" },
  input: z.object({
    period: z.enum(["this_week", "next_week", "this_month"]).optional(),
  }),
  describeAction: (input) => {
    const p = input.period ?? "this_week";
    const nl = p === "next_week" ? "volgende week" : p === "this_month" ? "deze maand" : "deze week";
    return `Rooster voor ${nl} automatisch vullen met concepten — nog NIET publiceren; jij controleert ze daarna op het planbord.`;
  },
  run: async (input, ctx) => {
    const period = input.period ?? "this_week";
    const { startUtc, endUtc, label } = periodRange(period, new Date());
    const res = await autofillWeek({ startUtc, endUtc, actorUserId: ctx.actor.requestedByUserId });
    return {
      data: { period, ...res },
      summary:
        res.filled === 0
          ? `Geen open plekken gevuld voor ${label} (alles vol of geen passende chefs beschikbaar).`
          : `${res.filled} concept(en) toegevoegd op ${res.shiftsTouched} dienst(en) voor ${label} (van ${res.openSlotsBefore} open plekken). Controleer op het planbord en publiceer daarna.`,
    };
  },
});
