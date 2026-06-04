/**
 * Day dispatch board — per-chef lane-packed bars on a shared, auto-fitted hour
 * track. One thin bar per chef (or open slot), coloured by lifecycle:
 *   gepland (blue) · bevestigd (light green) · gestart (solid green, live) ·
 *   uitgeklokt (grey) · open (dashed; red-dashed when the shift has nobody).
 * Overlapping bars stack in lanes (none hidden); the row grows to fit. Overnight
 * shifts (end past midnight) extend the axis past 24:00 with a "+1" marker.
 * Left rail = hotel · stad · x/y chefs · health pill. "+" column = new shift.
 * Read + navigate only.
 */

import Link from "next/link";

import type { DayHotel, SlotStatus } from "@/lib/domain/roster-intel";
import { dayToneOf, type DayTone } from "@/lib/domain/roster-intel";

const RAIL = 200;
const ADDCOL = 40;
const HOUR_PX = 46;
const BAR_H = 24;
const GAP = 2;
const PAD = 5;

/** Bar colour per lifecycle status. */
const BAR: Record<SlotStatus, string> = {
  gepland: "bg-blue-50 text-blue-800 border border-blue-200",
  bevestigd: "bg-emerald-100 text-emerald-900 border border-emerald-200",
  gestart: "bg-emerald-500 text-white",
  uitgeklokt: "bg-ink-200 text-ink-600",
  open: "bg-white text-ink-400 border border-dashed border-ink-300",
};
const STATUS_LABEL: Record<SlotStatus, string> = {
  gepland: "Gepland",
  bevestigd: "Bevestigd",
  gestart: "Gestart",
  uitgeklokt: "Uitgeklokt",
  open: "Open plek",
};
const LEGEND: SlotStatus[] = ["gepland", "bevestigd", "gestart", "uitgeklokt", "open"];

const PILL: Record<DayTone, { label: string; dot: string; text: string }> = {
  vol: { label: "Goed", dot: "bg-emerald-500", text: "text-emerald-700" },
  deels: { label: "Let op", dot: "bg-amber-500", text: "text-amber-700" },
  leeg: { label: "Kritiek", dot: "bg-red-500", text: "text-red-600" },
};

function amsHourFloat(d: Date | string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d instanceof Date ? d : new Date(d));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}
function hhmm(d: Date | string): string {
  return new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d instanceof Date ? d : new Date(d));
}
function shortName(full: string): string {
  const p = full.trim().split(/\s+/);
  return p.length === 1 ? p[0] : `${p[0]} ${p[p.length - 1][0]}.`;
}

type Bar = {
  shiftId: string;
  start: number; // hours from midnight (overnight end unwrapped to >24)
  end: number;
  name: string | null; // null = open slot
  status: SlotStatus;
  crit: boolean; // open slot on a shift with nobody confirmed
  startLabel: string;
  endLabel: string;
  lane: number;
};

/** Greedy lane-pack: each bar to the first lane free at its start. Returns lane count. */
function pack(bars: Bar[]): number {
  const sorted = [...bars].sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds: number[] = [];
  for (const b of sorted) {
    let lane = laneEnds.findIndex((e) => e <= b.start);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(b.end);
    } else {
      laneEnds[lane] = b.end;
    }
    b.lane = lane;
  }
  return laneEnds.length;
}

function barsForHotel(hotel: DayHotel, slotsByShift: Record<string, Array<{ name: string; status: SlotStatus }>>): Bar[] {
  const out: Bar[] = [];
  for (const s of hotel.shifts) {
    const start = amsHourFloat(s.row.startsAt);
    const rawEnd = amsHourFloat(s.row.endsAt);
    const end = rawEnd <= start ? rawEnd + 24 : rawEnd; // overnight unwrap
    const startLabel = hhmm(s.row.startsAt);
    const endLabel = hhmm(s.row.endsAt);
    const filled = slotsByShift[s.row.id] ?? [];
    const empty = s.fill.confirmed === 0;
    for (const slot of filled) {
      out.push({ shiftId: s.row.id, start, end, name: slot.name, status: slot.status, crit: false, startLabel, endLabel, lane: 0 });
    }
    const open = Math.max(0, s.fill.headcount - filled.length);
    for (let i = 0; i < open; i++) {
      out.push({ shiftId: s.row.id, start, end, name: null, status: "open", crit: empty, startLabel, endLabel, lane: 0 });
    }
  }
  return out;
}

function hotelTone(hotel: DayHotel): DayTone {
  let worst: DayTone = "vol";
  for (const s of hotel.shifts) {
    const t = dayToneOf(s.fill.confirmed, s.fill.headcount);
    if (t === "leeg") return "leeg";
    if (t === "deels") worst = "deels";
  }
  return worst;
}

export function RosterDayTimeline({
  hotels,
  nowHour,
  chefSlotsByShift = {},
}: {
  hotels: DayHotel[];
  nowHour: number | null;
  chefSlotsByShift?: Record<string, Array<{ name: string; status: SlotStatus }>>;
}) {
  if (hotels.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
        <p className="font-serif text-lg text-ink-900">Geen diensten op deze dag</p>
        <p className="mt-1 text-sm text-ink-500">Maak een dienst aan, of bekijk de week.</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Link href="/admin/business/shifts/new" className="rounded-full bg-burgundy px-4 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy/90">Nieuwe shift</Link>
          <Link href="/admin/business/roster?view=week" className="rounded-full border border-ink-200 px-4 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-ink-700 hover:border-burgundy hover:text-burgundy">Bekijk week</Link>
        </div>
      </div>
    );
  }

  // Build all bars first so the axis can fit overnight ends too.
  const hotelBars = hotels.map((h) => ({ hotel: h, bars: barsForHotel(h, chefSlotsByShift) }));
  const allBars = hotelBars.flatMap((h) => h.bars);
  const minStart = allBars.length ? Math.min(...allBars.map((b) => b.start)) : 6;
  const maxEnd = allBars.length ? Math.max(...allBars.map((b) => b.end)) : 22;
  const startHour = Math.max(6, Math.floor(minStart));
  let endHour = Math.min(26, Math.ceil(maxEnd));
  if (endHour - startHour < 8) endHour = Math.min(26, startHour + 8); // min 8h span
  const span = Math.max(1, endHour - startHour);
  const hours = Array.from({ length: span + 1 }, (_, i) => startHour + i);

  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const leftPct = (s: number) => clamp(((s - startHour) / span) * 100);
  const widthPct = (s: number, e: number) => clamp(((Math.max(e, s + 0.25) - s) / span) * 100);
  const markerPct = nowHour != null && nowHour >= startHour && nowHour <= endHour ? clamp(((nowHour - startHour) / span) * 100) : null;
  const markerLabel = nowHour != null ? `${String(Math.floor(nowHour)).padStart(2, "0")}:${String(Math.round((nowHour % 1) * 60)).padStart(2, "0")}` : "";

  return (
    <div>
      {/* legend */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-ui text-[10px] uppercase tracking-[0.16em] text-ink-400">Per chef:</span>
        {LEGEND.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-3.5 rounded ${k === "gepland" ? "border border-blue-200 bg-blue-50" : k === "bevestigd" ? "border border-emerald-200 bg-emerald-100" : k === "gestart" ? "bg-emerald-500" : k === "uitgeklokt" ? "bg-ink-200" : "border border-dashed border-ink-300 bg-white"}`} />
            <span className="font-ui text-[10px] text-ink-600">{STATUS_LABEL[k]}</span>
          </span>
        ))}
        <span className="font-ui text-[10px] text-ink-400">· 1 balk = 1 chef · overlap stapelt in banen</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-[0_1px_2px_rgba(41,41,42,0.04)]">
        <div style={{ minWidth: RAIL + ADDCOL + span * HOUR_PX }}>
          {/* hour axis + now-pill */}
          <div className="flex border-b border-ink-200">
            <div style={{ width: RAIL }} className="shrink-0 px-3 py-2">
              <span className="font-ui text-[10px] uppercase tracking-[0.16em] text-ink-400">Hotels</span>
            </div>
            <div className="relative flex-1">
              <div className="flex">
                {hours.map((h) => (
                  <div key={h} className={`flex-1 py-2 text-center font-ui text-[10px] tabular-nums tracking-wider ${h >= 24 ? "text-burgundy" : "text-ink-400"}`}>
                    {String(h % 24).padStart(2, "0")}:00
                  </div>
                ))}
              </div>
              {markerPct != null && (
                <span className="absolute top-1 z-20 -translate-x-1/2 rounded-full bg-red-500 px-1.5 py-0.5 font-ui text-[10px] font-semibold text-white" style={{ left: `${markerPct}%` }} aria-label={`Huidige tijd ${markerLabel}`}>
                  {markerLabel}
                </span>
              )}
            </div>
            <div style={{ width: ADDCOL }} className="shrink-0" />
          </div>

          {hotelBars.map(({ hotel, bars }) => {
            const lanes = Math.max(1, pack(bars));
            const rowH = PAD * 2 + lanes * BAR_H + (lanes - 1) * GAP;
            const filledCount = bars.filter((b) => b.name).length;
            const city = hotel.shifts[0]?.row.city ?? null;
            const pill = PILL[hotelTone(hotel)];
            return (
              <div key={hotel.clientId} className="flex border-b border-ink-100 last:border-0">
                <div style={{ width: RAIL }} className="shrink-0 border-r border-ink-100 px-3 py-2">
                  <p className="truncate font-serif text-[14px] leading-tight text-ink-900">{hotel.companyName}</p>
                  {city && <p className="truncate text-[10px] leading-tight text-ink-400">{city}</p>}
                  <p className="mt-0.5 flex items-center gap-1.5 font-ui text-[10px] text-ink-400">
                    {filledCount}/{bars.length} chefs
                    <span className={`flex items-center gap-1 ${pill.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
                      {pill.label}
                    </span>
                  </p>
                </div>

                <div className="relative flex-1" style={{ height: rowH }}>
                  <div className="absolute inset-0 flex">
                    {hours.slice(0, -1).map((h) => (
                      <div key={h} className={`flex-1 border-r ${h === 23 ? "border-ink-300" : "border-ink-100"}`} />
                    ))}
                  </div>
                  {markerPct != null && <div className="absolute top-0 bottom-0 z-20 w-px bg-red-500" style={{ left: `${markerPct}%` }} aria-hidden />}
                  {bars.map((b, i) => {
                    const overnight = b.end > 24;
                    const cls = b.status === "open" && b.crit ? "bg-red-50 text-red-700 border border-dashed border-red-300" : BAR[b.status];
                    const label = b.name ? shortName(b.name) : "Open";
                    const title = `${hotel.companyName} · ${b.startLabel}–${b.endLabel}${overnight ? " (+1)" : ""} · ${b.name ?? "Open plek"} · ${STATUS_LABEL[b.status]}`;
                    return (
                      <Link
                        key={`${b.shiftId}-${i}`}
                        href={`/admin/business/shifts/${b.shiftId}`}
                        style={{ left: `${leftPct(b.start)}%`, width: `${Math.max(widthPct(b.start, b.end), 6)}%`, top: PAD + b.lane * (BAR_H + GAP), height: BAR_H }}
                        className={`absolute flex items-center gap-1 overflow-hidden rounded px-1.5 ${cls} hover:z-30 hover:ring-1 hover:ring-burgundy/50 focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burgundy`}
                        title={title}
                        aria-label={title}
                      >
                        {b.status === "gestart" && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-white" />}
                        <span className="truncate font-ui text-[10px] font-medium leading-none">{label}</span>
                        <span className="ml-auto shrink-0 pl-1 font-ui text-[9px] leading-none tabular-nums opacity-70">
                          {b.startLabel}–{b.endLabel}{overnight ? " +1" : ""}
                        </span>
                      </Link>
                    );
                  })}
                </div>

                <div style={{ width: ADDCOL }} className="flex shrink-0 items-center justify-center border-l border-ink-100">
                  <Link
                    href="/admin/business/shifts/new"
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-dashed border-ink-200 text-ink-300 hover:border-burgundy hover:text-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burgundy"
                    title={`Nieuwe dienst voor ${hotel.companyName}`}
                    aria-label={`Nieuwe dienst voor ${hotel.companyName}`}
                  >
                    +
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
