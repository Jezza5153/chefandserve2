/**
 * Day dispatch board — one compact row per hotel on a shared, auto-fitted hour
 * track (06:00–22:00 default; otherwise floor(earliest)→ceil(latest), clamped
 * 06–23, ≥8h — see computeRosterDayAxis). Each shift is a block positioned by
 * start/end and tinted by confirmed-fill (vol green · deels amber · leeg red):
 * tijd · dienst · ratio · chef-namen. Left rail = hotel + stad + dienst-count +
 * health pill. A dedicated "+" column (never over a block) links to a new shift.
 * Live now-marker with a time pill. Read + navigate only.
 */

import Link from "next/link";

import type { DayHotel, DayHotelShift } from "@/lib/domain/roster-intel";
import { computeRosterDayAxis, dayToneOf, dienstLabel, type DayTone } from "@/lib/domain/roster-intel";

const RAIL = 200; // hotel rail px
const ADDCOL = 40; // "+" column px
const HOUR_PX = 46; // min px per hour column (drives horizontal scroll width)

const TONE: Record<DayTone, { block: string; role: string; ratio: string; status: string }> = {
  vol: { block: "border-emerald-200 border-l-emerald-400 bg-emerald-50", role: "text-emerald-900", ratio: "text-emerald-700", status: "gevuld" },
  deels: { block: "border-amber-200 border-l-amber-400 bg-amber-50", role: "text-amber-900", ratio: "text-amber-800", status: "onderbezet" },
  leeg: { block: "border-red-200 border-l-red-400 bg-red-50", role: "text-red-900", ratio: "text-red-700", status: "kritiek" },
};
const PILL: Record<DayTone, { label: string; dot: string; text: string }> = {
  vol: { label: "Goed", dot: "bg-emerald-500", text: "text-emerald-700" },
  deels: { label: "Let op", dot: "bg-amber-500", text: "text-amber-700" },
  leeg: { label: "Kritiek", dot: "bg-red-500", text: "text-red-600" },
};

function amsHourFloat(d: Date | string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(
    d instanceof Date ? d : new Date(d),
  );
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}
function hhmm(d: Date | string): string {
  return new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    d instanceof Date ? d : new Date(d),
  );
}
function shortName(full: string): string {
  const p = full.trim().split(/\s+/);
  return p.length === 1 ? p[0] : `${p[0]} ${p[p.length - 1][0]}.`;
}
function hotelTone(shifts: DayHotelShift[]): DayTone {
  let worst: DayTone = "vol";
  for (const s of shifts) {
    const t = dayToneOf(s.fill.confirmed, s.fill.headcount);
    if (t === "leeg") return "leeg";
    if (t === "deels") worst = "deels";
  }
  return worst;
}

export function RosterDayTimeline({
  hotels,
  nowHour,
  chefNamesByShift = {},
}: {
  hotels: DayHotel[];
  nowHour: number | null;
  chefNamesByShift?: Record<string, string[]>;
}) {
  if (hotels.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
        <p className="font-serif text-lg text-ink-900">Geen diensten op deze dag</p>
        <p className="mt-1 text-sm text-ink-500">Maak een dienst aan, of bekijk de week.</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Link href="/admin/business/shifts/new" className="rounded-full bg-burgundy px-4 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy/90">
            Nieuwe shift
          </Link>
          <Link href="/admin/business/roster?view=week" className="rounded-full border border-ink-200 px-4 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-ink-700 hover:border-burgundy hover:text-burgundy">
            Bekijk week
          </Link>
        </div>
      </div>
    );
  }

  // One shared axis for the whole board, fitted to the day's shifts.
  const allRows = hotels.flatMap((h) => h.shifts.map((s) => s.row));
  const { startHour, endHour } = computeRosterDayAxis(allRows);
  const span = Math.max(1, endHour - startHour);
  const hours = Array.from({ length: span + 1 }, (_, i) => startHour + i);
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const leftPct = (s: number) => clamp(((s - startHour) / span) * 100);
  const widthPct = (s: number, e: number) => clamp(((Math.max(e, s + 0.5) - s) / span) * 100);
  const markerPct = nowHour != null && nowHour >= startHour && nowHour <= endHour ? clamp(((nowHour - startHour) / span) * 100) : null;
  const markerLabel = nowHour != null ? `${String(Math.floor(nowHour)).padStart(2, "0")}:${String(Math.round((nowHour % 1) * 60)).padStart(2, "0")}` : "";

  return (
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
                <div key={h} className="flex-1 py-2 text-center font-ui text-[10px] tracking-wider text-ink-400">
                  {String(h).padStart(2, "0")}:00
                </div>
              ))}
            </div>
            {markerPct != null && (
              <span
                className="absolute top-1 z-20 -translate-x-1/2 rounded-full bg-red-500 px-1.5 py-0.5 font-ui text-[10px] font-semibold text-white"
                style={{ left: `${markerPct}%` }}
                aria-label={`Huidige tijd ${markerLabel}`}
              >
                {markerLabel}
              </span>
            )}
          </div>
          <div style={{ width: ADDCOL }} className="shrink-0" />
        </div>

        {hotels.map((hotel) => {
          const city = hotel.shifts[0]?.row.city ?? null;
          const pill = PILL[hotelTone(hotel.shifts)];
          return (
            <div key={hotel.clientId} className="flex border-b border-ink-100 last:border-0">
              <div style={{ width: RAIL }} className="shrink-0 border-r border-ink-100 px-3 py-2">
                <p className="truncate font-serif text-[14px] leading-tight text-ink-900">{hotel.companyName}</p>
                {city && <p className="truncate text-[10px] leading-tight text-ink-400">{city}</p>}
                <p className="mt-0.5 flex items-center gap-1.5 font-ui text-[10px] text-ink-400">
                  {hotel.shifts.length} {hotel.shifts.length === 1 ? "dienst" : "diensten"}
                  <span className={`flex items-center gap-1 ${pill.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
                    {pill.label}
                  </span>
                </p>
              </div>

              <div className="relative h-[66px] flex-1">
                <div className="absolute inset-0 flex">
                  {hours.slice(0, -1).map((h) => (
                    <div key={h} className="flex-1 border-r border-ink-100" />
                  ))}
                </div>
                {markerPct != null && <div className="absolute top-0 bottom-0 z-10 w-px bg-red-500" style={{ left: `${markerPct}%` }} aria-hidden />}
                {hotel.shifts.map((s) => {
                  const start = amsHourFloat(s.row.startsAt);
                  const end = amsHourFloat(s.row.endsAt);
                  const dt = dayToneOf(s.fill.confirmed, s.fill.headcount);
                  const tone = TONE[dt];
                  const names = (chefNamesByShift[s.row.id] ?? []).map(shortName).join(", ");
                  const label = `${dienstLabel(s.row.startsAt)} · ${hhmm(s.row.startsAt)}–${hhmm(s.row.endsAt)} · ${s.fill.confirmed}/${s.fill.headcount} · ${tone.status}`;
                  return (
                    <Link
                      key={s.row.id}
                      href={`/admin/business/shifts/${s.row.id}`}
                      style={{ left: `${leftPct(start)}%`, width: `${Math.max(widthPct(start, end), 12)}%` }}
                      className={`absolute top-2 flex h-[50px] flex-col justify-center gap-px overflow-hidden rounded-md border border-l-[3px] px-3 ${tone.block} hover:ring-2 hover:ring-burgundy/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burgundy`}
                      title={`${hotel.companyName} · ${label}`}
                      aria-label={`${hotel.companyName} · ${label}`}
                    >
                      <span className="truncate text-[10px] leading-tight text-ink-500">
                        {hhmm(s.row.startsAt)} – {hhmm(s.row.endsAt)}
                      </span>
                      <span className="flex items-center justify-between gap-1 leading-tight">
                        <span className={`truncate font-ui text-[13px] font-semibold ${tone.role}`}>{dienstLabel(s.row.startsAt)}</span>
                        <span className={`shrink-0 font-ui text-[13px] font-semibold tabular-nums ${tone.ratio}`}>
                          {s.fill.confirmed}/{s.fill.headcount}
                        </span>
                      </span>
                      <span className="truncate text-[10px] leading-tight text-ink-500">{names || "–"}</span>
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
  );
}
