/**
 * Day dispatch board — one row per hotel on a 06:00–23:00 track. Each shift is a
 * block positioned by start/end and tinted by confirmed-fill (vol green · deels
 * amber · leeg red). Block shows time · rol · ratio · chef-namen. Left rail =
 * hotel + stad + dienst-count + health pill. Read + navigate: blocks link to the
 * shift, the "+" links to a new shift. Current-time marker with a time pill.
 */

import Link from "next/link";

import type { DayHotel, DayHotelShift } from "@/lib/domain/roster-intel";
import { dayToneOf, type DayTone } from "@/lib/domain/roster-intel";

const START_HOUR = 6;
const END_HOUR = 23;
const SPAN = END_HOUR - START_HOUR; // 17h

const TONE: Record<DayTone, { block: string; role: string; ratio: string }> = {
  vol: { block: "border-emerald-400 bg-emerald-50", role: "text-emerald-900", ratio: "text-emerald-700" },
  deels: { block: "border-amber-400 bg-amber-50", role: "text-amber-900", ratio: "text-amber-800" },
  leeg: { block: "border-red-400 bg-red-50", role: "text-red-900", ratio: "text-red-700" },
};
const PILL: Record<DayTone, { label: string; dot: string; text: string }> = {
  vol: { label: "Goed", dot: "bg-emerald-500", text: "text-emerald-700" },
  deels: { label: "Let op", dot: "bg-amber-500", text: "text-amber-700" },
  leeg: { label: "Kritiek", dot: "bg-red-500", text: "text-red-600" },
};

function amsHourFloat(d: Date | string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d instanceof Date ? d : new Date(d));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}
function hhmm(d: Date | string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d instanceof Date ? d : new Date(d));
}
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const leftPct = (start: number) => clamp(((start - START_HOUR) / SPAN) * 100);
const widthPct = (start: number, end: number) => clamp(((Math.max(end, start + 0.5) - start) / SPAN) * 100);

/** vakniveau enum → friendly label ("sous_chef" → "Sous-chef"). */
function roleLabel(role: string): string {
  const s = role.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** "Marco Rossi" → "Marco R." */
function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
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
  const hours = Array.from({ length: SPAN + 1 }, (_, i) => START_HOUR + i);
  const markerPct =
    nowHour != null && nowHour >= START_HOUR && nowHour <= END_HOUR ? clamp(((nowHour - START_HOUR) / SPAN) * 100) : null;
  const markerLabel = nowHour != null ? `${String(Math.floor(nowHour)).padStart(2, "0")}:${String(Math.round((nowHour % 1) * 60)).padStart(2, "0")}` : "";

  if (hotels.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-ink-200 bg-white px-4 py-10 text-center text-sm text-ink-500">
        Geen diensten op deze dag.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-ink-200 bg-white">
      <div className="min-w-[920px]">
        {/* hour axis + now-pill */}
        <div className="flex border-b border-ink-200">
          <div className="w-[200px] shrink-0 px-3 py-1.5">
            <span className="font-ui text-[10px] uppercase tracking-[0.16em] text-ink-400">Hotels</span>
          </div>
          <div className="relative flex-1">
            <div className="flex">
              {hours.map((h) => (
                <div key={h} className="flex-1 py-1.5 text-center font-ui text-[10px] tracking-wider text-ink-400">
                  {String(h).padStart(2, "0")}:00
                </div>
              ))}
            </div>
            {markerPct != null && (
              <span
                className="absolute -bottom-0.5 z-20 -translate-x-1/2 rounded-full bg-red-500 px-1.5 py-0.5 font-ui text-[9px] font-semibold text-white"
                style={{ left: `${markerPct}%` }}
              >
                {markerLabel}
              </span>
            )}
          </div>
        </div>

        {hotels.map((hotel) => {
          const city = hotel.shifts[0]?.row.city ?? null;
          const pill = PILL[hotelTone(hotel.shifts)];
          return (
            <div key={hotel.clientId} className="flex border-b border-ink-100 last:border-0">
              <div className="w-[200px] shrink-0 border-r border-ink-100 px-3 py-3">
                <p className="truncate font-serif text-[15px] text-ink-900">{hotel.companyName}</p>
                {city && <p className="truncate text-[11px] text-ink-400">{city}</p>}
                <p className="mt-1 flex items-center gap-2 font-ui text-[10px] text-ink-400">
                  {hotel.shifts.length} {hotel.shifts.length === 1 ? "dienst" : "diensten"}
                  <span className={`flex items-center gap-1 ${pill.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
                    {pill.label}
                  </span>
                </p>
              </div>

              <div className="relative h-[80px] flex-1">
                {/* gridlines */}
                <div className="absolute inset-0 flex">
                  {hours.slice(0, -1).map((h) => (
                    <div key={h} className="flex-1 border-r border-ink-100/70" />
                  ))}
                </div>
                {markerPct != null && (
                  <div className="absolute top-0 bottom-0 z-10 w-px bg-red-500" style={{ left: `${markerPct}%` }} aria-hidden />
                )}
                {/* shift blocks */}
                {hotel.shifts.map((s) => {
                  const start = amsHourFloat(s.row.startsAt);
                  const end = amsHourFloat(s.row.endsAt);
                  const tone = TONE[dayToneOf(s.fill.confirmed, s.fill.headcount)];
                  const names = (chefNamesByShift[s.row.id] ?? []).map(shortName).join(", ");
                  return (
                    <Link
                      key={s.row.id}
                      href={`/admin/business/shifts/${s.row.id}`}
                      style={{ left: `${leftPct(start)}%`, width: `${Math.max(widthPct(start, end), 11)}%` }}
                      className={`absolute top-2.5 flex h-[60px] flex-col justify-center overflow-hidden rounded-md border-l-4 px-2 py-1 ${tone.block} hover:ring-2 hover:ring-burgundy/30`}
                      title={`${roleLabel(s.row.roleNeeded)} · ${hhmm(s.row.startsAt)}–${hhmm(s.row.endsAt)} · ${s.fill.confirmed}/${s.fill.headcount}`}
                    >
                      <span className="truncate font-ui text-[10px] text-ink-500">
                        {hhmm(s.row.startsAt)} – {hhmm(s.row.endsAt)}
                      </span>
                      <span className="flex items-center justify-between gap-1">
                        <span className={`truncate font-ui text-[12px] font-semibold ${tone.role}`}>{roleLabel(s.row.roleNeeded)}</span>
                        <span className={`shrink-0 font-ui text-[11px] font-medium tabular-nums ${tone.ratio}`}>
                          {s.fill.confirmed}/{s.fill.headcount}
                        </span>
                      </span>
                      <span className="truncate text-[10px] text-ink-500">{names || "–"}</span>
                    </Link>
                  );
                })}
                {/* add a shift to this hotel */}
                <Link
                  href="/admin/business/shifts/new"
                  className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md border border-dashed border-ink-200 text-ink-300 hover:border-burgundy hover:text-burgundy"
                  title="Nieuwe dienst voor dit hotel"
                  aria-label="Nieuwe dienst"
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
