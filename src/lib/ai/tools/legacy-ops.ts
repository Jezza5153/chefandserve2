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
      // The newest rows are forward bookings for a month that has not happened yet; quoting
      // one as "meest recent" turns three days of bookings into a fake collapse.
      const laatsteVolle = months.find((m) => m.afgerond);
      const lopend = months.filter((m) => !m.afgerond);
      return {
        data: { bron: "oude systeem", periode: `${summary.van} t/m ${summary.tot}`, maanden: months },
        summary:
          `Oude systeem, laatste ${months.length} maanden. Laatste AFGERONDE maand (${laatsteVolle?.month}): ${laatsteVolle?.diensten ?? 0} diensten, ${laatsteVolle?.urenGewerkt ?? 0} uur, bezetting ${laatsteVolle?.bezettingPct ?? "-"}%.` +
          (lopend.length
            ? ` ${lopend.map((m) => m.month).join(" en ")} ${lopend.length > 1 ? "zijn" : "is"} nog niet afgerond (alleen wat al geboekt staat) — vergelijk die niet met een volle maand.`
            : ""),
      };
    }

    if (view === "zelfde_maand") {
      const m = input.maand ?? new Date().getMonth() + 1;
      const rows = await getLegacySameMonth(m);
      const vol = rows.filter((r) => r.afgerond);
      const gem = vol.length ? Math.round(vol.reduce((a, r) => a + r.diensten, 0) / vol.length) : 0;
      const lopend = rows.filter((r) => !r.afgerond);
      return {
        data: { bron: "oude systeem", maand: MONTH_NL[m - 1], jaren: rows },
        summary: vol.length
          ? `${MONTH_NL[m - 1]} in het oude systeem: gemiddeld ${gem} diensten per jaar over ${vol.length} afgeronde ${vol.length === 1 ? "jaar" : "jaren"} (${vol.map((r) => `${r.month.slice(0, 4)}: ${r.diensten}`).join(", ")}).` +
            (lopend.length
              ? ` ${lopend.map((r) => `${r.month.slice(0, 4)}: ${r.diensten}`).join(", ")} telt niet mee — die maand loopt nog.`
              : "")
          : `Geen afgeronde ${MONTH_NL[m - 1]} in het archief.`,
      };
    }

    if (view === "per_klant") {
      const { klanten, totalen, teMigreren } = await getLegacyClientDemand(input.limit ?? 15);
      return {
        data: { bron: "oude systeem", klanten, totalen, nogOverzetten: teMigreren },
        summary:
          `Oude systeem, top ${klanten.length} klanten: ${klanten.slice(0, 3).map((r) => `${r.klant} (${r.diensten})`).join(", ")}.` +
          ` Over het HELE archief: ${totalen.in_dit_systeem} staan hier als klant, ${totalen.opgevolgd} zijn onder een nieuwe naam voortgezet, ${totalen.nog_niet_overgezet} boeken daar nog zonder account hier, ${totalen.weggevallen} boeken al langer niet meer.` +
          (teMigreren.length
            ? ` Om over te zetten: ${teMigreren.slice(0, 5).map((r) => `${r.klant} (${r.diensten})`).join(", ")} — dat zijn GEEN verloren klanten.`
            : "") +
          ` Alleen de laatste groep is verlies, en ook daarvan geldt: "geen klant hier onder deze naam" is geen bewijs dat ze weg zijn.`,
      };
    }

    return {
      data: { bron: "oude systeem", ...summary },
      summary:
        `Oude systeem (${summary.van} t/m ${summary.tot}, incl. wat daar al vooruit geboekt staat): ${summary.diensten.toLocaleString("nl-NL")} diensten, ${summary.uren.toLocaleString("nl-NL")} gewerkte uren, gemiddelde bezetting ${summary.bezettingPct ?? "-"}%. Dit staat LOS van de cijfers van dit systeem.` +
        (summary.bijgewerkt ? ` Momentopname van ${summary.bijgewerkt} — zeg dat erbij als het antwoord over "nu" gaat.` : ""),
    };
  },
});
