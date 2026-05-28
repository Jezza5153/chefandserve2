/**
 * /admin/business/roster — PR-1. The control-center canvas.
 *
 * A visual week/month roster of shifts coloured by deterministic operational
 * health (not raw status) + next-action + warnings, with an "Aandacht nodig"
 * strip up top. Glance → understand → click a card → existing shift detail.
 * No schema, no deps, no AI — pure read + the `roster-format` intelligence.
 * Thresholds/labels come from `DEFAULT_ROSTER_SETTINGS` (the planned Instellingen
 * page will feed per-employee overrides into the same helpers).
 */

import { and, gte, lt, eq, sql } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { clients, placements, shifts } from "@/lib/db/schema";
import { requireRole } from "@/lib/permissions";
import {
  addDaysToKey,
  amsterdamDayKey,
  bucketShiftsByAmsterdamDay,
  getAmsterdamMonthGrid,
  getAmsterdamWeekRange,
  getFillState,
  getShiftHealth,
  getShiftNextAction,
  getShiftWarnings,
  needsAttention,
  shiftMonthKey,
  type ShiftIntelInput,
} from "@/lib/roster-format";

import { HEALTH_META, RosterShiftCard } from "./_components/RosterShiftCard";

export const metadata = { title: "Rooster" };
export const dynamic = "force-dynamic";

function fmtDay(key: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("nl-NL", {
    timeZone: "UTC",
    ...opts,
  });
}

export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string }>;
}) {
  await requireRole("owner");
  const sp = await searchParams;
  const view = sp.view === "month" ? "month" : "week";

  const week = view === "week" ? getAmsterdamWeekRange(sp.week) : null;
  const month = view === "month" ? getAmsterdamMonthGrid(sp.week) : null;
  const startUtc = week?.startUtc ?? month!.startUtc;
  const endUtc = week?.endUtc ?? month!.endUtc;

  const rows = await db
    .select({
      id: shifts.id,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      roleNeeded: shifts.roleNeeded,
      segment: shifts.segment,
      headcount: shifts.headcount,
      location: shifts.location,
      city: shifts.city,
      status: shifts.status,
      companyName: clients.companyName,
      confirmedCount: sql<number>`count(*) filter (where ${placements.status} = 'confirmed')::int`,
      acceptedCount: sql<number>`count(*) filter (where ${placements.status} = 'accepted')::int`,
      proposedCount: sql<number>`count(*) filter (where ${placements.status} = 'proposed')::int`,
    })
    .from(shifts)
    .leftJoin(clients, eq(clients.id, shifts.clientId))
    .leftJoin(placements, eq(placements.shiftId, shifts.id))
    .where(and(gte(shifts.startsAt, startUtc), lt(shifts.startsAt, endUtc)))
    .groupBy(shifts.id, clients.companyName)
    .orderBy(shifts.startsAt);

  const items = rows.map((r) => {
    const input: ShiftIntelInput = {
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      status: r.status,
      headcount: r.headcount,
      confirmedCount: r.confirmedCount,
      proposedCount: r.proposedCount,
      acceptedCount: r.acceptedCount,
      location: r.location,
      city: r.city,
      hasClient: Boolean(r.companyName),
    };
    return {
      row: r,
      health: getShiftHealth(input),
      nextAction: getShiftNextAction(input),
      warnings: getShiftWarnings(input),
      fill: getFillState(input),
      attention: needsAttention(input),
    };
  });

  const byDay = bucketShiftsByAmsterdamDay(items.map((i) => ({ ...i, startsAt: i.row.startsAt })));
  const todayKey = amsterdamDayKey(new Date());
  const isActive = (h: string) => h !== "done" && h !== "cancelled";

  const counts = {
    vandaag: items.filter((i) => amsterdamDayKey(i.row.startsAt) === todayKey).length,
    period: items.length,
    onbemand: items.filter((i) => isActive(i.health) && i.row.confirmedCount === 0).length,
    onderbezet: items.filter(
      (i) => isActive(i.health) && i.row.confirmedCount > 0 && i.row.confirmedCount < i.row.headcount,
    ).length,
  };

  const attention = items.filter((i) => i.attention);

  const periodLabel = view === "month" ? "deze maand" : "deze week";
  const title =
    view === "month"
      ? fmtDay(`${month!.monthKey}-01`, { month: "long", year: "numeric" })
      : `${fmtDay(week!.startKey, { day: "numeric", month: "short" })} – ${fmtDay(week!.endKey, { day: "numeric", month: "short", year: "numeric" })}`;

  const prevHref =
    view === "month"
      ? `/admin/business/roster?view=month&week=${shiftMonthKey(month!.monthKey, -1)}`
      : `/admin/business/roster?week=${addDaysToKey(week!.startKey, -7)}`;
  const nextHref =
    view === "month"
      ? `/admin/business/roster?view=month&week=${shiftMonthKey(month!.monthKey, 1)}`
      : `/admin/business/roster?week=${addDaysToKey(week!.startKey, 7)}`;

  return (
    <div className="mx-auto max-w-6xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Operations</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-4xl text-ink-900 md:text-5xl">Rooster</h1>
        <div className="flex items-center gap-2">
          <Link href={prevHref} className="rounded-full border border-ink-200 bg-white px-3 py-1.5 font-ui text-[11px] text-ink-700 hover:border-burgundy hover:text-burgundy">←</Link>
          <Link href="/admin/business/roster" className="rounded-full border border-ink-200 bg-white px-3 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-700 hover:border-burgundy hover:text-burgundy">Vandaag</Link>
          <Link href={nextHref} className="rounded-full border border-ink-200 bg-white px-3 py-1.5 font-ui text-[11px] text-ink-700 hover:border-burgundy hover:text-burgundy">→</Link>
          <span className="mx-1 hidden text-ink-200 sm:inline">|</span>
          <Link href={view === "week" ? `/admin/business/roster?view=month&week=${week!.startKey}` : `/admin/business/roster?week=${month!.gridDays[7]}`}
            className="rounded-full border border-burgundy/40 bg-white px-3 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5">
            {view === "week" ? "Maand" : "Week"}
          </Link>
        </div>
      </div>
      <p className="mt-1 font-serif text-lg text-ink-700">{title}</p>

      {/* Glance header */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Glance label="Vandaag" value={counts.vandaag} />
        <Glance label={periodLabel} value={counts.period} />
        <Glance label="Onbemand" value={counts.onbemand} tone={counts.onbemand > 0 ? "amber" : "ok"} />
        <Glance label="Onderbezet" value={counts.onderbezet} tone={counts.onderbezet > 0 ? "amber" : "ok"} />
      </div>

      {/* Aandacht nodig strip */}
      {attention.length > 0 && (
        <section className="mt-6 rounded-lg border border-amber-300 bg-amber-50/60 p-4">
          <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-amber-800">
            Aandacht nodig ({attention.length})
          </h2>
          <ul className="mt-2 space-y-1.5">
            {attention.map((i) => (
              <li key={i.row.id}>
                <Link
                  href={`/admin/business/shifts/${i.row.id}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded px-2 py-1.5 text-sm hover:bg-white"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${HEALTH_META[i.health].dot}`} />
                  <span className="font-medium text-ink-900">{i.row.companyName ?? "Onbekende klant"}</span>
                  <span className="text-ink-500">
                    {fmtDay(amsterdamDayKey(i.row.startsAt), { weekday: "short", day: "numeric", month: "short" })} · {i.row.roleNeeded} · {i.row.confirmedCount}/{i.row.headcount}
                  </span>
                  <span className="ml-auto font-ui text-[10px] font-medium uppercase tracking-wider text-burgundy">{i.nextAction}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Calendar */}
      {view === "week" ? (
        <div className="mt-6 overflow-x-auto">
          <div className="grid min-w-[860px] grid-cols-7 gap-2">
            {week!.days.map((dayKey) => {
              const dayItems = byDay.get(dayKey) ?? [];
              const isToday = dayKey === todayKey;
              return (
                <div key={dayKey} className="min-w-0">
                  <div className={`mb-2 rounded px-2 py-1 text-center font-ui text-[11px] uppercase tracking-wider ${isToday ? "bg-burgundy text-white" : "text-ink-500"}`}>
                    {fmtDay(dayKey, { weekday: "short", day: "numeric" })}
                  </div>
                  <div className="space-y-2">
                    {dayItems.length === 0 ? (
                      <p className="rounded border border-dashed border-ink-200 px-2 py-3 text-center text-[11px] text-ink-400">—</p>
                    ) : (
                      dayItems.map((i) => (
                        <RosterShiftCard
                          key={i.row.id}
                          shift={{ ...i.row }}
                          intel={{ health: i.health, nextAction: i.nextAction, warnings: i.warnings, fill: i.fill }}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <div className="grid grid-cols-7 gap-px rounded-lg border border-ink-200 bg-ink-200 text-center font-ui text-[10px] uppercase tracking-wider text-ink-500">
            {["ma", "di", "wo", "do", "vr", "za", "zo"].map((d) => (
              <div key={d} className="bg-bg-gray py-1.5">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-b-lg border-x border-b border-ink-200 bg-ink-200">
            {month!.gridDays.map((dayKey, idx) => {
              const dayItems = byDay.get(dayKey) ?? [];
              const inMonth = month!.inMonth[idx];
              const isToday = dayKey === todayKey;
              return (
                <Link
                  key={dayKey}
                  href={`/admin/business/roster?week=${dayKey}`}
                  className={`flex min-h-[64px] flex-col gap-1 p-1.5 ${inMonth ? "bg-white" : "bg-bg-gray/50"} hover:bg-burgundy/5`}
                >
                  <span className={`font-ui text-[11px] ${isToday ? "font-bold text-burgundy" : inMonth ? "text-ink-700" : "text-ink-400"}`}>
                    {Number(dayKey.slice(8))}
                  </span>
                  {dayItems.length > 0 && (
                    <span className="flex flex-wrap items-center gap-0.5">
                      {dayItems.slice(0, 6).map((i) => (
                        <span key={i.row.id} className={`h-1.5 w-1.5 rounded-full ${HEALTH_META[i.health].dot}`} />
                      ))}
                      {dayItems.length > 6 && <span className="text-[9px] text-ink-500">+{dayItems.length - 6}</span>}
                    </span>
                  )}
                  {dayItems.length > 0 && (
                    <span className="mt-auto text-[10px] text-ink-500">{dayItems.length} {dayItems.length === 1 ? "dienst" : "diensten"}</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="mt-6 rounded-lg border border-ink-200 bg-white p-10 text-center">
          <p className="font-serif text-lg text-ink-900">Geen diensten in {periodLabel}</p>
          <p className="mt-2 text-sm text-ink-500">
            Maak er een aan via{" "}
            <Link href="/admin/business/shifts/new" className="text-burgundy hover:underline">Nieuwe shift</Link>.
          </p>
        </div>
      )}
    </div>
  );
}

function Glance({ label, value, tone = "ok" }: { label: string; value: number; tone?: "ok" | "amber" }) {
  return (
    <div className={`rounded-lg border p-4 ${tone === "amber" && value > 0 ? "border-amber-300 bg-amber-50" : "border-ink-200 bg-white"}`}>
      <p className="font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">{label}</p>
      <p className="mt-1 font-serif text-2xl text-ink-900">{value}</p>
    </div>
  );
}
