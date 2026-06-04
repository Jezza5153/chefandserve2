/**
 * /admin/business/roster — PR-1. The operator's CONTROL TOWER (read + navigate).
 *
 * One toggle, three lenses on the same truth:
 *   • Dag   = dispatch board (per-hotel 06–23 timeline + open-diensten + supply)
 *   • Week  = staffing map (hotels × 7 days, venue-first)
 *   • Maand = planning radar (risk-tinted heatmap + live KPIs)
 *
 * EVERYTHING the screen shows comes from ONE engine — `buildRosterView` in
 * `roster-intel` — and the AI reads the SAME object via `rosterAiSummary`. KPIs
 * are clickable filters (read-only narrowing). Every CTA links to the existing
 * shift/chef detail page: NO inline mutations (solving lives in the future Planner).
 */

import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { chefAvailability, chefs, clients, placements, shifts } from "@/lib/db/schema";
import {
  rankAttentionItems,
  type AttentionItem,
  type AttentionTone,
} from "@/lib/domain/dashboard-intel";
import {
  buildRosterView,
  chefSlotStatus,
  dagdeelLabel,
  dagdeelOf,
  dayToneOf,
  dienstLabel,
  detectOverlaps,
  type SlotStatus,
  monthCellFor,
  rosterAiSummary,
  shiftFill,
  type AvailableChefRow,
  type Dagdeel,
  type MonthDayCell,
  type RosterShiftRow,
  type RosterView,
} from "@/lib/domain/roster-intel";
import { getRosterSettings } from "@/lib/domain/user-settings";
import { requireRole } from "@/lib/permissions";
import {
  addDaysToKey,
  amsterdamDayKey,
  amsterdamMidnightUtc,
  getAmsterdamMonthGrid,
  getAmsterdamWeekRange,
  shiftMonthKey,
  type RosterSettings,
} from "@/lib/roster-format";

import { Icon } from "@/components/admin/icons";
import { BeschikbareChefsTable, type ChefRow } from "./_components/BeschikbareChefsTable";
import { OpenDienstenTable, type OpenDienstRow } from "./_components/OpenDienstenTable";
import { RosterDayTimeline } from "./_components/RosterDayTimeline";
import { RosterKpiStrip, type KpiTile } from "./_components/RosterKpiStrip";
import { RosterMonthHeatmap } from "./_components/RosterMonthHeatmap";
import { RosterWeekGrid } from "./_components/RosterWeekGrid";

export const metadata = { title: "Rooster" };
export const dynamic = "force-dynamic";

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const humanize = (s: string) => cap(s.replace(/_/g, " "));

function fmtDay(key: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("nl-NL", { timeZone: "UTC", ...opts });
}
function hhmm(d: Date | string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d instanceof Date ? d : new Date(d));
}
/** Amsterdam hour-of-day as a float (13.5 = 13:30) for the now-marker. */
function amsHourFloat(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const mn = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + mn / 60;
}

const TONE_DOT: Record<AttentionTone, string> = { red: "bg-red-500", amber: "bg-amber-500", blue: "bg-blue-500", grey: "bg-ink-400" };
const TONE_TEXT: Record<AttentionTone, string> = { red: "text-red-700", amber: "text-amber-800", blue: "text-blue-700", grey: "text-ink-500" };

const FILTER_LABEL: Record<string, string> = {
  ingevuld: "Ingevuld",
  open: "Open",
  kritiek: "Kritiek",
  onderbezet: "Onderbezet",
  conflicts: "Dubbele boekingen",
  beschikbaar: "Beschikbare chefs",
};
function filterLabel(f: string): string {
  if (f.startsWith("role:")) return `Dagdeel: ${dagdeelLabel(f.slice(5) as Dagdeel)}`;
  if (f.startsWith("hotel:")) return "Eén hotel";
  return FILTER_LABEL[f] ?? f;
}

/** Read-only narrowing — which loaded shifts a `?filter=` keeps in the body. */
function rowMatchesFilter(
  filter: string,
  row: RosterShiftRow,
  settings: Partial<RosterSettings>,
  now: Date,
  conflictShiftIds: Set<string>,
): boolean {
  const fill = shiftFill(row, settings, now);
  if (filter === "ingevuld") return fill.confirmed >= fill.headcount;
  if (filter === "open") return fill.confirmed > 0 && fill.confirmed < fill.headcount;
  if (filter === "kritiek") return fill.confirmed <= 0;
  if (filter === "onderbezet") return fill.openSlots > 0 && fill.confirmed > 0;
  if (filter === "conflicts") return conflictShiftIds.has(row.id);
  if (filter.startsWith("role:")) return dagdeelOf(row.startsAt) === filter.slice(5);
  if (filter.startsWith("hotel:")) return row.clientId === filter.slice(6);
  return true; // "beschikbaar" / unknown → no row narrowing
}

export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; week?: string; filter?: string }>;
}) {
  const session = await requireRole("owner");
  const sp = await searchParams;
  const rosterSettings = await getRosterSettings(session.user.id);
  const now = new Date();
  const todayKey = amsterdamDayKey(now);

  const view: RosterView =
    sp.view === "day" ? "day" : sp.view === "month" ? "month" : sp.view === "week" ? "week" : rosterSettings.defaultView;
  const anchor = sp.date && KEY_RE.test(sp.date) ? sp.date : sp.week && KEY_RE.test(sp.week) ? sp.week : todayKey;
  const filter = sp.filter ?? null;

  const week = view === "week" ? getAmsterdamWeekRange(anchor) : null;
  const month = view === "month" ? getAmsterdamMonthGrid(anchor) : null;
  const dateKey = view === "day" ? anchor : week ? week.startKey : `${month!.monthKey}-01`;
  const startUtc = week?.startUtc ?? month?.startUtc ?? amsterdamMidnightUtc(anchor);
  const endUtc = week?.endUtc ?? month?.endUtc ?? amsterdamMidnightUtc(addDaysToKey(anchor, 1));
  const settings = { criticalHours: rosterSettings.criticalHours, labels: rosterSettings.labels };

  /* ── load the period's shifts + placement-pipeline counts ── */
  const rows = await db
    .select({
      id: shifts.id,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      roleNeeded: shifts.roleNeeded,
      headcount: shifts.headcount,
      location: shifts.location,
      city: shifts.city,
      status: shifts.status,
      clientId: shifts.clientId,
      companyName: clients.companyName,
      confirmedCount: sql<number>`count(*) filter (where ${placements.status} = 'confirmed')::int`,
      acceptedCount: sql<number>`count(*) filter (where ${placements.status} = 'accepted')::int`,
      proposedCount: sql<number>`count(*) filter (where ${placements.status} = 'proposed')::int`,
      earliestProposedAt: sql<string | null>`min(${placements.proposedAt}) filter (where ${placements.status} = 'proposed')`,
    })
    .from(shifts)
    .leftJoin(clients, eq(clients.id, shifts.clientId))
    .leftJoin(placements, eq(placements.shiftId, shifts.id))
    .where(and(gte(shifts.startsAt, startUtc), lt(shifts.startsAt, endUtc)))
    .groupBy(shifts.id, clients.companyName)
    .orderBy(shifts.startsAt);

  const shiftRows: RosterShiftRow[] = rows.map((r) => ({
    id: r.id,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    roleNeeded: r.roleNeeded,
    headcount: r.headcount,
    status: r.status,
    location: r.location,
    city: r.city,
    clientId: r.clientId,
    companyName: r.companyName,
    confirmedCount: r.confirmedCount,
    acceptedCount: r.acceptedCount,
    proposedCount: r.proposedCount,
    earliestProposedAt: r.earliestProposedAt,
  }));

  /* ── Day extras: chef names per shift · overlaps · free-not-placed supply ── */
  let chefSlotsByShift: Record<string, Array<{ name: string; status: SlotStatus }>> = {};
  let availableChefs: AvailableChefRow[] = [];
  let chefTableRows: ChefRow[] = [];
  let overlaps: ReturnType<typeof detectOverlaps> = [];
  const conflictShiftIds = new Set<string>();

  if (view === "day") {
    const dayShiftIds = shiftRows.map((r) => r.id);

    const placementRows = dayShiftIds.length
      ? await db
          .select({
            shiftId: placements.shiftId,
            chefId: placements.chefId,
            chefName: chefs.fullName,
            status: placements.status,
            startsAt: shifts.startsAt,
            endsAt: shifts.endsAt,
          })
          .from(placements)
          .innerJoin(chefs, eq(chefs.id, placements.chefId))
          .innerJoin(shifts, eq(shifts.id, placements.shiftId))
          .where(and(inArray(placements.shiftId, dayShiftIds), inArray(placements.status, ["accepted", "confirmed"])))
      : [];

    chefSlotsByShift = {};
    for (const p of placementRows)
      (chefSlotsByShift[p.shiftId] ??= []).push({
        name: p.chefName,
        status: chefSlotStatus(p.status, p.startsAt, p.endsAt, now),
      });

    overlaps = detectOverlaps(
      placementRows.map((p) => ({ chefId: p.chefId, chefName: p.chefName, shiftId: p.shiftId, startsAt: p.startsAt, endsAt: p.endsAt })),
    );
    if (overlaps.length > 0) {
      const overlapChefs = new Set(overlaps.map((o) => o.chefId));
      for (const p of placementRows) if (overlapChefs.has(p.chefId)) conflictShiftIds.add(p.shiftId);
    }

    const placedRows = dayShiftIds.length
      ? await db
          .selectDistinct({ chefId: placements.chefId })
          .from(placements)
          .where(and(inArray(placements.shiftId, dayShiftIds), inArray(placements.status, ["proposed", "accepted", "confirmed", "completed"])))
      : [];
    const placedSet = new Set(placedRows.map((r) => r.chefId));

    const dayDate = new Date(`${dateKey}T00:00:00Z`);
    const blockedRows = await db
      .select({ chefId: chefAvailability.chefId })
      .from(chefAvailability)
      .where(and(eq(chefAvailability.date, dayDate), eq(chefAvailability.available, false)));
    const blockedSet = new Set(blockedRows.map((r) => r.chefId));

    const activeChefs = await db
      .select({
        id: chefs.id,
        fullName: chefs.fullName,
        city: chefs.city,
        segments: chefs.segments,
        vakniveau: chefs.vakniveau,
      })
      .from(chefs)
      .where(and(isNull(chefs.deletedAt), eq(chefs.status, "active")));

    const free = activeChefs.filter((c) => !placedSet.has(c.id) && !blockedSet.has(c.id));
    availableChefs = free.map((c) => ({ id: c.id, fullName: c.fullName, city: c.city, skills: c.segments ?? [] }));
    chefTableRows = free.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      niveau: c.vakniveau ? humanize(c.vakniveau) : null,
      skills: c.segments ?? [],
      locatie: c.city,
    }));
  }

  /* ── engine: truth header (full) + body (filter-narrowed) ── */
  const vmFull = buildRosterView({ view, dateKey, rows: shiftRows, availableChefs: view === "day" ? availableChefs : undefined, settings, now });
  const ai = rosterAiSummary(vmFull);

  const bodyRows = filter != null ? shiftRows.filter((r) => rowMatchesFilter(filter, r, settings, now, conflictShiftIds)) : shiftRows;
  const vmBody =
    filter != null
      ? buildRosterView({ view, dateKey, rows: bodyRows, availableChefs: view === "day" ? availableChefs : undefined, settings, now })
      : vmFull;

  /* ── KPI tiles ── */
  const navHref = (a: string) => `/admin/business/roster?view=${view}&date=${a}`;
  const toggleHref = (v: RosterView) => `/admin/business/roster?view=${v}&date=${anchor}`;
  const kpiHref = (f?: string) => `/admin/business/roster?view=${view}&date=${anchor}${f ? `&filter=${encodeURIComponent(f)}` : ""}`;
  const kpiTiles: KpiTile[] = vmFull.kpis.map((k) => ({
    key: k.key,
    label: k.label,
    value: k.key === "bezetting" ? `${k.value}%` : k.value,
    pct: k.pct,
    detail: k.detail,
    tone: k.tone,
    href: kpiHref(k.filter),
  }));

  /* ── Day: open-diensten rows (from the narrowed body) ── */
  const ACTIVE = (h: string) => h !== "done" && h !== "cancelled";
  let openRows: OpenDienstRow[] = [];
  let openTotal = 0;
  if (view === "day") {
    const all: OpenDienstRow[] = [];
    for (const hotel of vmBody.dayHotels ?? []) {
      for (const s of hotel.shifts) {
        if (!ACTIVE(s.fill.health)) continue;
        const tone = dayToneOf(s.fill.confirmed, s.fill.headcount);
        if (tone === "vol") continue;
        all.push({
          shiftId: s.row.id,
          hotel: hotel.companyName,
          start: `${hhmm(s.row.startsAt)} – ${hhmm(s.row.endsAt)}`,
          dienst: dienstLabel(s.row.startsAt),
          nodig: Math.max(0, s.fill.headcount - s.fill.confirmed),
          reden: tone === "leeg" ? "kritiek" : "open",
        });
      }
    }
    openTotal = all.length;
    openRows = all.slice(0, 7);
  }

  /* ── attention rail (week/month only — Day uses the tables) ── */
  const overlapItems: AttentionItem[] = overlaps.map((o) => ({
    kind: "critical_shift",
    tone: "red",
    icon: "alert-triangle",
    title: `${o.chefName} dubbel geboekt`,
    detail: `Overlap ${o.from}–${o.to} — controleer de planning`,
    href: `/admin/business/chefs/${o.chefId}`,
    cta: "Bekijk chef",
  }));
  const railItems = rankAttentionItems([...overlapItems, ...vmBody.attention]);

  const prevAnchor =
    view === "day" ? addDaysToKey(anchor, -1) : view === "week" ? addDaysToKey(week!.startKey, -7) : shiftMonthKey(month!.monthKey, -1);
  const nextAnchor =
    view === "day" ? addDaysToKey(anchor, 1) : view === "week" ? addDaysToKey(week!.startKey, 7) : shiftMonthKey(month!.monthKey, 1);
  const periodLabel =
    view === "day"
      ? cap(fmtDay(anchor, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))
      : view === "week"
        ? `${fmtDay(week!.startKey, { day: "numeric", month: "short" })} – ${fmtDay(week!.endKey, { day: "numeric", month: "short", year: "numeric" })}`
        : cap(fmtDay(`${month!.monthKey}-01`, { month: "long", year: "numeric" }));

  const monthCells: MonthDayCell[] = view === "month" ? month!.gridDays.map((k, i) => monthCellFor(vmBody, k, month!.inMonth[i])) : [];
  const showMarker = view === "day" && anchor === todayKey;

  return (
    <div className="mx-auto max-w-6xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.2em] text-burgundy">Operations</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl text-ink-900 md:text-4xl">Rooster</h1>
          <p className="mt-0.5 font-serif text-base text-ink-700">{periodLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-full border border-ink-200 bg-white">
            {(["day", "week", "month"] as RosterView[]).map((v) => (
              <Link
                key={v}
                href={toggleHref(v)}
                className={`px-3.5 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] ${
                  view === v ? "bg-burgundy text-white" : "text-ink-600 hover:bg-bg-gray"
                }`}
              >
                {v === "day" ? "Dag" : v === "week" ? "Week" : "Maand"}
              </Link>
            ))}
          </div>
          <span className="mx-0.5 hidden text-ink-200 sm:inline">|</span>
          <Link href={navHref(prevAnchor)} className="rounded-full border border-ink-200 bg-white px-3 py-1.5 font-ui text-[11px] text-ink-700 hover:border-burgundy hover:text-burgundy">←</Link>
          <Link href={`/admin/business/roster?view=${view}`} className="rounded-full border border-ink-200 bg-white px-3 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-700 hover:border-burgundy hover:text-burgundy">Vandaag</Link>
          <Link href={navHref(nextAnchor)} className="rounded-full border border-ink-200 bg-white px-3 py-1.5 font-ui text-[11px] text-ink-700 hover:border-burgundy hover:text-burgundy">→</Link>
          <Link href="/admin/business/shifts/new" className="ml-1 flex items-center gap-1 rounded-full bg-burgundy px-3.5 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy/90">
            <Icon name="plus-circle" className="h-3.5 w-3.5" />
            Nieuwe shift
          </Link>
        </div>
      </div>

      <RosterKpiStrip items={kpiTiles} />

      {filter && (
        <div className="mt-4 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-burgundy/10 px-3 py-1 font-ui text-[11px] font-medium text-burgundy">
            Filter: {filterLabel(filter)}
          </span>
          <Link href={kpiHref()} className="font-ui text-[11px] text-ink-500 underline hover:text-burgundy">toon alles</Link>
        </div>
      )}

      {view === "day" ? (
        <div className="mt-6 space-y-6">
          <RosterDayTimeline hotels={vmBody.dayHotels ?? []} nowHour={showMarker ? amsHourFloat(now) : null} chefSlotsByShift={chefSlotsByShift} />
          <div className="grid gap-6 lg:grid-cols-2">
            <OpenDienstenTable rows={openRows} total={openTotal} />
            <BeschikbareChefsTable rows={chefTableRows.slice(0, 6)} total={chefTableRows.length} />
          </div>
        </div>
      ) : (
        <>
          {ai.text && (
            <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-burgundy/20 bg-burgundy/[0.03] px-4 py-3">
              <Icon name="sparkles" className="mt-0.5 h-4 w-4 shrink-0 text-burgundy" />
              <p className="text-sm text-ink-800">
                <span className="font-ui text-[10px] uppercase tracking-[0.16em] text-burgundy">Samenvatting</span>
                <span className="ml-1">{ai.text}</span>
              </p>
            </div>
          )}
          <AttentionRail items={railItems} />
          {view === "week" ? (
            <RosterWeekGrid hotels={vmBody.weekHotels ?? []} weekDays={week!.days} todayKey={todayKey} />
          ) : (
            <RosterMonthHeatmap cells={monthCells} todayKey={todayKey} topHotels={vmFull.monthTopHotels ?? []} roleShortage={vmFull.monthRoleShortage ?? []} />
          )}
        </>
      )}
    </div>
  );
}

/** "Aandacht nodig" rail — week/month (Day uses the open-diensten table instead). */
function AttentionRail({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="mt-6 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 px-4 py-3">
        <Icon name="check-circle" className="h-4 w-4 text-emerald-600" />
        <p className="text-sm text-emerald-800">Alles op schema — geen openstaande aandachtspunten.</p>
      </div>
    );
  }
  return (
    <section className="mt-6 rounded-lg border border-ink-200 bg-white">
      <div className="border-b border-ink-100 px-4 py-3">
        <h2 className="flex items-center gap-1.5 font-ui text-[11px] uppercase tracking-[0.16em] text-burgundy">
          <Icon name="alert-triangle" className="h-4 w-4" />
          Aandacht nodig ({items.length})
        </h2>
      </div>
      <ul className="divide-y divide-ink-100">
        {items.map((it, i) => (
          <li key={`${it.kind}-${i}`}>
            <Link href={it.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-gray">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-gray ${TONE_TEXT[it.tone]}`}>
                <Icon name={it.icon} className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[it.tone]}`} />
                  <span className="truncate font-ui text-[13px] font-medium text-ink-900">{it.title}</span>
                </span>
                {it.detail && <span className="mt-0.5 block truncate text-[12px] text-ink-500">{it.detail}</span>}
              </span>
              {it.cta && (
                <span className="hidden shrink-0 items-center gap-1 font-ui text-[11px] font-medium text-burgundy sm:flex">
                  {it.cta}
                  <Icon name="arrow-right" className="h-3.5 w-3.5" />
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
