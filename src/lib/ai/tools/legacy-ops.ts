/**
 * ops.history — the assistant's window on the operational archive of the OLD system.
 *
 * Without this, every "hoe druk is juli normaal", "welke klant boekte het meest" or "is
 * dit een normale week" gets answered from a system that has run zero shifts: the honest
 * answer is 0, and the useful answer sits in four years of archive. This tool serves the
 * archive explicitly labelled as such, so the model can say "in het oude systeem" instead
 * of blending two systems into one wrong number.
 *
 * Read-only, owner surface (shifts.read). Aggregates only — no chef or shift PII.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import {
  getLegacyClientDemand,
  getLegacyMonths,
  getLegacySameMonth,
  getLegacySummary,
} from "@/lib/domain/legacy-ops";

const MONTH_NL = ["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];

export const opsHistory = defineTool({
  name: "ops.history",
  title: "Historie uit het oude systeem",
  description:
    'De operationele cijfers uit het OUDE systeem (2022 tot nu): hoeveel diensten en gewerkte uren per maand, de bezettingsgraad, en welke klanten hoeveel boekten. Gebruik dit bij vragen over VROEGER of over wat NORMAAL is: "hoe druk is juli normaal", "hoeveel diensten deden we vorig jaar", "welke klant boekte het meest", "welke klanten zijn we kwijt", "is dit een normale week". Twee dingen om nooit door elkaar te halen: (1) het oude systeem draait NOG — het boekt door, dus een klant die daar staat en hier niet is meestal nog niet overgezet in plaats van kwijt (view per_klant geeft per klant de status); (2) tel deze cijfers NOOIT op bij die van dit systeem, noem ze apart. Read-only.',
  risk: "read",
  permission: { resource: "shifts", action: "read" },
  input: z.object({
    view: z
      .enum(["samenvatting", "per_maand", "zelfde_maand", "per_klant"])
      .optional()
      .describe("samenvatting (standaard) · per_maand (laatste maanden) · zelfde_maand (deze maand in eerdere jaren) · per_klant (wie boekte het meest)"),
    maand: z.number().int().min(1).max(12).optional().describe("Voor view=zelfde_maand: 1-12. Standaard de huidige maand."),
    limit: z.number().int().min(1).max(36).optional(),
  }),
  run: async (input) => {
    const view = input.view ?? "samenvatting";
    const summary = await getLegacySummary();
    if (!summary) {
      return {
        data: { available: false },
        summary: "Er staat nog geen historie uit het oude systeem in het archief.",
      };
    }

    if (view === "per_maand") {
      const months = await getLegacyMonths(input.limit ?? 12);
      const top = months[0];
      return {
        data: { bron: "oude systeem", periode: `${summary.van} t/m ${summary.tot}`, maanden: months },
        summary: `Oude systeem, laatste ${months.length} maanden. Meest recent (${top?.month}): ${top?.diensten ?? 0} diensten, ${top?.urenGewerkt ?? 0} uur, bezetting ${top?.bezettingPct ?? "-"}%.`,
      };
    }

    if (view === "zelfde_maand") {
      const m = input.maand ?? new Date().getMonth() + 1;
      const rows = await getLegacySameMonth(m);
      const gem = rows.length ? Math.round(rows.reduce((a, r) => a + r.diensten, 0) / rows.length) : 0;
      return {
        data: { bron: "oude systeem", maand: MONTH_NL[m - 1], jaren: rows },
        summary: rows.length
          ? `${MONTH_NL[m - 1]} in het oude systeem: gemiddeld ${gem} diensten per jaar (${rows.map((r) => `${r.month.slice(0, 4)}: ${r.diensten}`).join(", ")}).`
          : `Geen historie voor ${MONTH_NL[m - 1]} in het archief.`,
      };
    }

    if (view === "per_klant") {
      const rows = await getLegacyClientDemand(input.limit ?? 15);
      const overzetten = rows.filter((r) => r.status === "nog_niet_overgezet");
      const opgevolgd = rows.filter((r) => r.status === "opgevolgd");
      const kwijt = rows.filter((r) => r.status === "weggevallen");
      return {
        data: { bron: "oude systeem", klanten: rows },
        summary:
          `Oude systeem, top ${rows.length} klanten: ${rows.slice(0, 3).map((r) => `${r.klant} (${r.diensten})`).join(", ")}.` +
          (overzetten.length
            ? ` LET OP: ${overzetten.length} boeken NOG STEEDS in het oude systeem maar staan hier nog niet als klant (${overzetten.slice(0, 3).map((r) => r.klant).join(", ")}) — accounts om over te zetten, GEEN verloren klanten.`
            : "") +
          (opgevolgd.length
            ? ` ${opgevolgd.length} regels zijn onder een nieuwe naam voortgezet (${opgevolgd.slice(0, 2).map((r) => `${r.klant} → ${r.voortgezetAls}`).join("; ")}) — noem die niet als verlies.`
            : "") +
          (kwijt.length ? ` ${kwijt.length} klanten boeken al een tijd niet meer en staan hier ook niet — die zijn wél weggevallen.` : ""),
      };
    }

    return {
      data: { bron: "oude systeem", ...summary },
      summary: `Oude systeem (${summary.van} t/m ${summary.tot}): ${summary.diensten.toLocaleString("nl-NL")} diensten, ${summary.uren.toLocaleString("nl-NL")} gewerkte uren, gemiddelde bezetting ${summary.bezettingPct ?? "-"}%. Dit staat LOS van de cijfers van dit systeem.`,
    };
  },
});
