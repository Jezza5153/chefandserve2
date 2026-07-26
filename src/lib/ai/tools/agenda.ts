/**
 * Agenda tools — the owner's verbal reality captured into the system (FLYWHEEL).
 *
 * Maarten's promises live in his head and his WhatsApp: "ik beloofde Daniel vrijdag
 * vrij", "morgen Hilton terugbellen". agenda.remember turns that sentence into an
 * agenda_events row (visible on the dashboard Vandaag-strip, the planning page and
 * the calendar feed); agenda.vandaag reads the day back. Same registry conventions
 * as reminders.*: remember = risk "self" (internal work item, nothing leaves the
 * building), vandaag = read.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { chefs, clients } from "@/lib/db/schema";
import { defineTool } from "@/lib/ai/tools/registry";
import { createAgendaEvent, agendaEventLabel } from "@/lib/domain/agenda-events";
import { agendaToday } from "@/lib/ai/read-model/agenda";
import { amsterdamMidnightUtc } from "@/lib/roster-format";

export const agendaVandaag = defineTool({
  name: "agenda.vandaag",
  title: "Wat staat er vandaag op mijn agenda",
  description:
    "De agenda van vandaag (en optioneel morgen): intakegesprekken, opvolgingen, interne herinneringen en beloftes, met gekoppelde chef/klant. Voor \"wat staat er vandaag / wat heb ik beloofd / wat mag ik niet vergeten?\". Read-only.",
  risk: "read",
  permission: { resource: "planning", action: "read" },
  input: z.object({
    includeTomorrow: z.boolean().optional().describe("Ook morgen meenemen."),
  }),
  run: async (input) => {
    const items = await agendaToday({ includeTomorrow: input.includeTomorrow === true });
    return {
      data: { count: items.length, items },
      summary:
        items.length === 0
          ? "Niets op de agenda — geen open afspraken of beloftes."
          : `${items.length} agendapunt(en) — eerstvolgende: ${items[0]!.title}.`,
    };
  },
});

export const agendaRemember = defineTool({
  name: "agenda.remember",
  title: "Belofte of afspraak vastleggen",
  description:
    'Legt een belofte, afspraak of "niet vergeten" vast als agendapunt: "ik beloofde Daniel vrijdag vrij te houden", "morgen Hotel X terugbellen", "vrijdag contract mailen". ' +
    "Geef een korte titel + datum (JJJJ-MM-DD, zonder datum = vandaag) en koppel waar mogelijk de chef of klant (id via chefs.find / clients.find — dan verschijnt de belofte óók op hun dossier). " +
    "Verschijnt op het dashboard (Vandaag-strip), de planning en in de agenda-feed. Intern — er wordt niets naar de chef of klant gestuurd. NIET voor persoonlijke to-do's zonder datum of belofte — dat is reminders.create.",
  risk: "self",
  permission: { resource: "planning", action: "write" },
  input: z.object({
    title: z.string().min(3).max(200).describe('Kort en concreet: "Daniel vrijdag vrij houden".'),
    date: z.string().optional().describe("JJJJ-MM-DD. Leeg = vandaag."),
    time: z.string().optional().describe("UU:MM (Amsterdam). Leeg = 09:00."),
    notes: z.string().max(500).optional(),
    linkedChefId: z.string().optional(),
    linkedClientId: z.string().optional(),
  }),
  run: async (input, ctx) => {
    const day = input.date?.trim() || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`"${input.date}" is geen geldige datum (JJJJ-MM-DD)`);
    const time = input.time?.trim() || "09:00";
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error(`"${input.time}" is geen geldige tijd (UU:MM)`);
    // Amsterdam wall clock, DST-correct (the SPOED-page lesson: a hardcoded +02:00
    // is wrong from late October to late March).
    const [hh, mm] = time.split(":").map(Number);
    const startsAt = new Date(amsterdamMidnightUtc(day).getTime() + hh! * 3600e3 + mm! * 60e3);

    // Linked ids are FK-constrained — a hallucinated id would raise a raw 23503. Validate
    // first so the model gets a correctable Dutch error instead.
    if (input.linkedChefId) {
      const [c] = await db.select({ id: chefs.id }).from(chefs).where(eq(chefs.id, input.linkedChefId)).limit(1);
      if (!c) throw new Error("chefId bestaat niet — zoek het juiste id met chefs.find");
    }
    if (input.linkedClientId) {
      const [c] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, input.linkedClientId)).limit(1);
      if (!c) throw new Error("clientId bestaat niet — zoek het juiste id met clients.find");
    }

    const row = await createAgendaEvent({
      type: "internal_reminder",
      startsAt,
      title: input.title,
      notes: input.notes ?? null,
      linkedChefId: input.linkedChefId || null,
      linkedClientId: input.linkedClientId || null,
      createdBy: ctx.actor.requestedByUserId,
    });
    return {
      data: { id: row.id, title: row.title, startsAt: row.startsAt, type: agendaEventLabel(row.type) },
      summary: `Vastgelegd: "${row.title}" op ${day} ${time}. Staat op je dashboard en in de agenda.`,
    };
  },
});
