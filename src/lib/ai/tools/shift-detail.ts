/**
 * shifts.detail — one shift's full operational picture (read-only). Complements shifts.find
 * (locate) + shifts.suggest_chefs (fill) + hours.detail (one row): this is the "stand van zaken"
 * for a single dienst.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { shiftDetailForAi } from "@/lib/ai/read-model/shift-detail";
import { listInterestedChefs } from "@/lib/domain/shift-interests";

export const shiftsDetail = defineTool({
  name: "shifts.detail",
  title: "Dienst in detail",
  description:
    "De volledige stand van één dienst: klant · wanneer · rol · status · bezetting (ingevuld/nodig + open plekken) · het team erop (elke chef met plaatsingsstatus én uren-status) · aantal opmerkingen. Voor 'wat is de stand van dienst X / wie staat erop / zijn de uren al binnen?'. Read-only. Gebruik shifts.find of shifts.open_soon voor het shiftId.",
  risk: "read",
  permission: { resource: "shifts", action: "read" },
  input: z.object({ shiftId: z.string().min(1, "shiftId is verplicht") }),
  run: async (input) => {
    const d = await shiftDetailForAi(input.shiftId);
    if (!d) throw new Error("deze dienst bestaat niet (meer)");
    const summary = `${d.klant}, ${d.wanneer} (${d.rol}) — ${d.status}, bezetting ${d.bezetting}${d.open > 0 ? ` · ⚠ ${d.open} open` : ""}.`;
    return { data: d, summary };
  },
});

export const shiftsInterestedChefs = defineTool({
  name: "shifts.interested_chefs",
  title: "Chefs die zich aanmeldden",
  description:
    "Welke chefs hebben via 'Open diensten' hun hand opgestoken voor een open dienst (CHEF-OPEN) — naam + sinds wanneer. Voor 'wie heeft interesse in dienst X / wie wil deze shift?'. Read-only. Gebruik shifts.find of shifts.open_soon voor het shiftId.",
  risk: "read",
  permission: { resource: "shifts", action: "read" },
  input: z.object({ shiftId: z.string().min(1, "shiftId is verplicht") }),
  run: async (input) => {
    const list = await listInterestedChefs(input.shiftId);
    const summary =
      list.length === 0
        ? "Nog geen chefs aangemeld voor deze dienst."
        : `${list.length} chef(s) met interesse: ${list.map((c) => c.name).join(", ")}.`;
    return { data: { count: list.length, chefs: list }, summary };
  },
});
