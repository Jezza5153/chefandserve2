/**
 * shifts.create (wave PR-8) — "maak een dienst aan voor vrijdag bij Okura". Confirm-gated:
 * the model PREPARES the shift, Maarten clicks ja. Wraps the SAME domain createShift() the
 * /admin/business/shifts/new page calls — one verb, one function.
 */
import { z } from "zod";

import { createShift, SHIFT_ROLE_VALUES, type ShiftRole } from "@/lib/domain/shifts";
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

export const shiftsCreate = defineTool({
  name: "shifts.create",
  title: "Dienst aanmaken",
  description:
    "Maak een nieuwe OPEN dienst aan voor een klant. Vereist clientId (zoek eerst met clients.find), start- en eindtijd (ISO, Europe/Amsterdam), en de rol (een van: " +
    SHIFT_ROLE_VALUES.join(", ") +
    "). Optioneel: headcount (default 1), city, location, notes. De dienst komt als 'open' in de planning; stel daarna chefs voor met shifts.suggest_chefs. Bevestiging vereist.",
  risk: "outbound",
  permission: { resource: "shifts", action: "write" },
  input: z.object({
    clientId: z.string().min(1, "clientId is verplicht (zoek met clients.find)"),
    startsAt: z.string().min(10, "starttijd (ISO) is verplicht"),
    endsAt: z.string().min(10, "eindtijd (ISO) is verplicht"),
    roleNeeded: z.enum(SHIFT_ROLE_VALUES as [ShiftRole, ...ShiftRole[]]),
    headcount: z.number().int().min(1).max(20).optional(),
    city: z.string().optional(),
    location: z.string().optional(),
    notes: z.string().max(2000).optional(),
  }),
  describeAction: (i) =>
    `Nieuwe dienst aanmaken: ${i.roleNeeded}${(i.headcount ?? 1) > 1 ? ` ×${i.headcount}` : ""} op ${fmt(i.startsAt)}–${fmt(i.endsAt)} voor klant ${i.clientId}${i.city ? ` (${i.city})` : ""}.`,
  run: async (input, ctx) => {
    const res = await createShift({
      clientId: input.clientId,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      roleNeeded: input.roleNeeded,
      headcount: input.headcount,
      city: input.city ?? null,
      location: input.location ?? null,
      notes: input.notes ?? null,
      createdBy: ctx.actor.requestedByUserId,
    });
    if (!res.ok) return { data: res, summary: `Niet gelukt: ${res.error}` };
    return {
      data: res,
      summary: `Dienst aangemaakt bij ${res.client} (${fmt(input.startsAt)}). Bekijk: /admin/business/shifts/${res.shiftId} — zal ik chefs voorstellen?`,
    };
  },
});
