/**
 * Agenda read-model — today's (and optionally tomorrow's) OPEN agenda events for the
 * assistant + the dashboard Vandaag-strip. Humanized: type labels, linked names,
 * Amsterdam times — no raw enums reach the model (house rule).
 */
import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { agendaEvents, chefs, clients } from "@/lib/db/schema";
import { agendaEventLabel } from "@/lib/domain/agenda-events";
import { addDaysToKey, amsterdamDayKey, amsterdamMidnightUtc } from "@/lib/roster-format";

export type AgendaTodayItem = {
  id: string;
  time: string; // "09:00" Amsterdam
  day: "vandaag" | "morgen";
  title: string;
  type: string; // humanized label
  notes: string | null;
  chefName: string | null;
  clientName: string | null;
};

export async function agendaToday(opts: { includeTomorrow?: boolean } = {}): Promise<AgendaTodayItem[]> {
  const todayKey = amsterdamDayKey(new Date());
  const start = amsterdamMidnightUtc(todayKey);
  const end = amsterdamMidnightUtc(addDaysToKey(todayKey, opts.includeTomorrow ? 2 : 1));

  const rows = await db
    .select({
      id: agendaEvents.id,
      startsAt: agendaEvents.startsAt,
      title: agendaEvents.title,
      type: agendaEvents.type,
      notes: agendaEvents.notes,
      chefName: chefs.fullName,
      clientName: clients.companyName,
    })
    .from(agendaEvents)
    .leftJoin(chefs, and(eq(chefs.id, agendaEvents.linkedChefId), isNull(chefs.deletedAt)))
    .leftJoin(clients, eq(clients.id, agendaEvents.linkedClientId))
    .where(
      and(
        eq(agendaEvents.status, "open"),
        gte(agendaEvents.startsAt, start),
        lt(agendaEvents.startsAt, end),
        inArray(agendaEvents.type, ["intake_call", "follow_up", "onboarding_task", "contract_start", "internal_reminder"]),
      ),
    )
    .orderBy(asc(agendaEvents.startsAt));

  return rows.map((r) => ({
    id: r.id,
    time: new Date(r.startsAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }),
    day: amsterdamDayKey(r.startsAt) === todayKey ? ("vandaag" as const) : ("morgen" as const),
    title: r.title,
    type: agendaEventLabel(r.type),
    notes: r.notes,
    chefName: r.chefName,
    clientName: r.clientName,
  }));
}
