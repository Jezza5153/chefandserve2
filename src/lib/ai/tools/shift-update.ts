/**
 * shifts.update (AI reality-audit gap #1) — "zet die dienst een uur later" / "maak er 2
 * plekken van" / "verander de rol naar sous-chef" / "pas het tarief aan". Wraps the SAME
 * domain updateShift() (one verb, one function). Confirm-gated. Works only while NO chefs are
 * confirmed yet; once committed, the domain refuses and the model is told to use a change
 * request. For a NEW shift use shifts.create.
 */
import { z } from "zod";

import { updateShift, SHIFT_ROLE_VALUES, type ShiftRole } from "@/lib/domain/shifts";
import { defineTool } from "@/lib/ai/tools/registry";

const fmt = (iso: string) =>
  new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

const euro = (cents: number) => `€${(cents / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2 })}`;

export const shiftsUpdate = defineTool({
  name: "shifts.update",
  title: "Dienst wijzigen",
  description:
    "Pas een BESTAANDE dienst aan: starttijd/eindtijd (ISO, Europe/Amsterdam), rol (een van: " +
    SHIFT_ROLE_VALUES.join(", ") +
    "), aantal plekken (headcount), klant-/cheftarief (in centen), stad of locatie. Geef shiftId (via shifts.find of het id van de huidige pagina) + ALLEEN de velden die wijzigen. Werkt alleen zolang er nog GEEN chefs bevestigd zijn — daarna moet het via een wijzigingsverzoek. Voor een NIEUWE dienst: shifts.create. Bevestiging vereist.",
  risk: "outbound",
  permission: { resource: "shifts", action: "write" },
  input: z.object({
    shiftId: z.string().min(1, "shiftId is verplicht (shifts.find of de huidige pagina)"),
    startsAt: z.string().min(10).optional(),
    endsAt: z.string().min(10).optional(),
    roleNeeded: z.enum(SHIFT_ROLE_VALUES as [ShiftRole, ...ShiftRole[]]).optional(),
    headcount: z.number().int().min(1).max(20).optional(),
    clientRateCents: z.number().int().min(0).optional(),
    chefRateCents: z.number().int().min(0).optional(),
    city: z.string().optional(),
    location: z.string().optional(),
  }),
  describeAction: (i) => {
    const parts: string[] = [];
    if (i.startsAt) parts.push(`start → ${fmt(i.startsAt)}`);
    if (i.endsAt) parts.push(`eind → ${fmt(i.endsAt)}`);
    if (i.roleNeeded) parts.push(`rol → ${i.roleNeeded}`);
    if (i.headcount != null) parts.push(`plekken → ${i.headcount}`);
    if (i.clientRateCents != null) parts.push(`klanttarief → ${euro(i.clientRateCents)}`);
    if (i.chefRateCents != null) parts.push(`cheftarief → ${euro(i.chefRateCents)}`);
    if (i.city != null) parts.push(`stad → ${i.city}`);
    if (i.location != null) parts.push(`locatie → ${i.location}`);
    return `Dienst ${i.shiftId} wijzigen: ${parts.length ? parts.join(" · ") : "(geen velden opgegeven)"}.`;
  },
  run: async (input, ctx) => {
    const res = await updateShift({
      shiftId: input.shiftId,
      editorUserId: ctx.actor.requestedByUserId,
      startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
      endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
      roleNeeded: input.roleNeeded,
      headcount: input.headcount,
      clientRateCents: input.clientRateCents,
      chefRateCents: input.chefRateCents,
      city: input.city,
      location: input.location,
    });
    if (!res.ok) return { data: res, summary: `Niet gelukt: ${res.error}` };
    return {
      data: res,
      summary: res.changed.length
        ? `Dienst aangepast (${res.changed.join(", ")}). Bekijk: /admin/business/shifts/${res.shiftId}`
        : "Geen wijzigingen — de waarden waren al zo.",
    };
  },
});
