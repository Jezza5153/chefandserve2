/**
 * /client/week — PR-KLANT-B1. The klant's visual week: 7 day-columns of THEIR
 * shifts with the proposed/confirmed chef + "wat gebeurt er nu?". The klant-side
 * mirror of the operator planbord — read-only and published-only.
 *
 * Draft placements (planbord concepts) are EXCLUDED here exactly as everywhere
 * else a klant looks: a shift with only a draft reads as "wacht op planning".
 * No raw status reaches the UI — every cell goes through getClientShiftLabel.
 */
import { and, eq, gte, inArray, lt, ne } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { chefs, clients, placements, shiftHours, shifts } from "@/lib/db/schema";
import { getClientShiftLabel } from "@/lib/client-shift-labels";
import { formatChefRole } from "@/lib/labels";
import { requireAuth } from "@/lib/permissions";
import { addDaysToKey, amsterdamDayKey, getAmsterdamWeekRange } from "@/lib/roster-format";

export const metadata = { title: "Mijn week", robots: { index: false } };
export const dynamic = "force-dynamic";

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Most-progressed first — same ordering the shift hub uses for its headline. */
const RANK = ["proposed", "accepted", "confirmed", "completed", "cancelled", "rejected", "no_show"];
const rank = (s: string) => RANK.indexOf(s);

function timeRange(start: Date | string, end: Date | string): string {
  const s = new Date(start);
  const e = new Date(end);
  const t = (d: Date) => d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  return `${t(s)}–${t(e)}`;
}

export default async function ClientWeekPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const session = await requireAuth("/client/week");
  const client = await db.query.clients.findFirst({ where: eq(clients.userId, session.user.id) });
  if (!client) {
    return (
      <p className="rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
        Geen klant-profiel gekoppeld aan dit account.
      </p>
    );
  }

  const sp = await searchParams;
  const todayKey = amsterdamDayKey(new Date());
  const anchor = sp.week && KEY_RE.test(sp.week) ? sp.week : todayKey;
  const week = getAmsterdamWeekRange(anchor);

  const shiftRows = await db
    .select({
      id: shifts.id,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      roleNeeded: shifts.roleNeeded,
      status: shifts.status,
      city: shifts.city,
    })
    .from(shifts)
    .where(
      and(
        eq(shifts.clientId, client.id),
        gte(shifts.startsAt, week.startUtc),
        lt(shifts.startsAt, week.endUtc),
      ),
    )
    .orderBy(shifts.startsAt);
  const shiftIds = shiftRows.map((s) => s.id);

  // Non-draft placements only — a concept never reveals a chef to the klant.
  const plRows = shiftIds.length
    ? await db
        .select({
          shiftId: placements.shiftId,
          status: placements.status,
          chefName: chefs.fullName,
          chefNiveau: chefs.vakniveau,
        })
        .from(placements)
        .innerJoin(chefs, eq(chefs.id, placements.chefId))
        .where(and(inArray(placements.shiftId, shiftIds), ne(placements.status, "draft")))
    : [];

  const hoursRows = shiftIds.length
    ? await db
        .select({ shiftId: shiftHours.shiftId, status: shiftHours.status })
        .from(shiftHours)
        .where(inArray(shiftHours.shiftId, shiftIds))
    : [];
  const hoursByShift = new Map(hoursRows.map((h) => [h.shiftId, h.status]));

  // Best (most-progressed) non-draft placement per shift.
  const bestByShift = new Map<string, (typeof plRows)[number]>();
  for (const p of plRows) {
    const cur = bestByShift.get(p.shiftId);
    if (!cur || rank(p.status) > rank(cur.status)) bestByShift.set(p.shiftId, p);
  }

  const byDay: Record<string, typeof shiftRows> = {};
  for (const s of shiftRows) (byDay[amsterdamDayKey(s.startsAt)] ??= []).push(s);

  const totalShifts = shiftRows.length;

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Mijn week</p>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-serif text-3xl text-ink-900 md:text-4xl">Weekoverzicht</h1>
        <div className="flex items-center gap-2 font-ui text-[11px] uppercase tracking-[0.15em]">
          <Link
            href={`/client/week?week=${addDaysToKey(week.startKey, -7)}`}
            className="rounded-full border border-ink-200 px-3 py-1.5 text-ink-700 hover:border-burgundy hover:text-burgundy"
          >
            ← Vorige
          </Link>
          <Link
            href="/client/week"
            className="rounded-full border border-ink-200 px-3 py-1.5 text-ink-700 hover:border-burgundy hover:text-burgundy"
          >
            Deze week
          </Link>
          <Link
            href={`/client/week?week=${addDaysToKey(week.startKey, 7)}`}
            className="rounded-full border border-ink-200 px-3 py-1.5 text-ink-700 hover:border-burgundy hover:text-burgundy"
          >
            Volgende →
          </Link>
        </div>
      </div>
      <p className="mt-3 text-sm text-ink-500">
        {totalShifts === 0 ? (
          <>
            Geen shifts deze week.{" "}
            <Link href="/client/request" className="text-burgundy underline-offset-4 hover:underline">
              Vraag een dienst aan →
            </Link>
          </>
        ) : (
          `${totalShifts} ${totalShifts === 1 ? "shift" : "shifts"} deze week. Klik een shift voor alle details.`
        )}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {week.days.map((dayKey) => {
          const dShifts = byDay[dayKey] ?? [];
          const dt = new Date(`${dayKey}T12:00:00Z`);
          const isToday = dayKey === todayKey;
          return (
            <div key={dayKey} className="rounded-lg border border-ink-200 bg-white p-2">
              <div className={`mb-2 px-1 ${isToday ? "text-burgundy" : "text-ink-500"}`}>
                <p className="font-ui text-[10px] uppercase tracking-[0.15em]">
                  {dt.toLocaleDateString("nl-NL", { weekday: "short" })}
                </p>
                <p className="font-serif text-lg text-ink-900">
                  {dt.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                </p>
              </div>
              {dShifts.length === 0 ? (
                <p className="px-1 py-3 text-center text-[11px] text-ink-300">—</p>
              ) : (
                <ul className="space-y-1.5">
                  {dShifts.map((s) => {
                    const best = bestByShift.get(s.id);
                    const label = getClientShiftLabel({
                      shiftStatus: s.status,
                      hasPlacement: Boolean(best),
                      placementStatus: best?.status ?? null,
                      hoursStatus: hoursByShift.get(s.id) ?? null,
                    });
                    return (
                      <li key={s.id}>
                        <Link
                          href={`/client/shifts/${s.id}`}
                          className="block rounded-md border border-ink-100 bg-bg-gray px-2 py-1.5 hover:border-burgundy/40"
                        >
                          <p className="font-ui text-[11px] font-medium tabular-nums text-ink-900">
                            {timeRange(s.startsAt, s.endsAt)}
                          </p>
                          <p className="truncate text-xs text-ink-700">
                            {formatChefRole(s.roleNeeded)}
                          </p>
                          {best?.chefName ? (
                            <p className="mt-0.5 truncate text-[11px] text-ink-500">
                              {best.chefName}
                            </p>
                          ) : null}
                          <p className="mt-1 truncate text-[10px] font-medium text-burgundy">
                            {label.humanStatus}
                          </p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-ink-500">
        Wil je deze week in je eigen agenda?{" "}
        <Link href="/client/calendar" className="text-burgundy hover:underline">
          Abonneer op de agenda
        </Link>
        .
      </p>
    </div>
  );
}
