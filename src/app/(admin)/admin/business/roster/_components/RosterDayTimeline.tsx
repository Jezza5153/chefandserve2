/**
 * Day dispatch board — one row per hotel, a 06:00–23:00 hours track with shift
 * blocks positioned by start/end and coloured by fill health. Read + navigate:
 * each block links to the shift detail page. Horizontally scrollable on mobile.
 */

import Link from "next/link";

import { HEALTH_META } from "@/components/admin/shiftVisuals";
import type { DayHotel, DayHotelShift } from "@/lib/domain/roster-intel";
import { dagdeelLabel } from "@/lib/domain/roster-intel";

const START_HOUR = 6;
const END_HOUR = 23;
const SPAN = END_HOUR - START_HOUR; // 17h

/** Amsterdam hour-of-day as a float (13.5 = 13:30) for positioning. */
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

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** Confirmation-pipeline label: "2/2 · bevestigd" / "Vacature open" / "Kritiek". */
function blockLabel(s: DayHotelShift): { ratio: string; sub: string } {
  const f = s.fill;
  const ratio = `${f.confirmed}/${f.headcount}`;
  if (f.health === "critical") return { ratio, sub: "Kritiek · vacature open" };
  if (f.gevuld) return { ratio, sub: "bevestigd" };
  if (f.teBevestigen) return { ratio, sub: `${f.accepted} te bevestigen` };
  if (f.confirmed === 0) return { ratio, sub: "vacature open" };
  return { ratio, sub: `${f.openSlots} open` };
}

export function RosterDayTimeline({
  hotels,
  nowHour,
  chefNamesByShift = {},
}: {
  hotels: DayHotel[];
  /** Amsterdam hour-float of "now" for the current-time marker (null = hide). */
  nowHour: number | null;
  chefNamesByShift?: Record<string, string[]>;
}) {
  const hours = Array.from({ length: SPAN + 1 }, (_, i) => START_HOUR + i);
  const markerPct =
    nowHour != null && nowHour >= START_HOUR && nowHour <= END_HOUR
      ? clampPct(((nowHour - START_HOUR) / SPAN) * 100)
      : null;

  if (hotels.length === 0) {
    return (
      <p className="mt-6 rounded-lg border border-dashed border-ink-200 bg-white px-4 py-10 text-center text-sm text-ink-500">
        Geen diensten op deze dag.
      </p>
    );
  }

  return (
    <div className="mt-6 overflow-x-auto rounded-lg border border-ink-200 bg-white">
      <div className="min-w-[860px]">
        {/* hour axis */}
        <div className="flex border-b border-ink-200 pl-[180px]">
          {hours.map((h) => (
            <div
              key={h}
              className="flex-1 py-1.5 text-center font-ui text-[10px] tracking-wider text-ink-400"
            >
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {hotels.map((hotel) => (
          <div key={hotel.clientId} className="flex border-b border-ink-100 last:border-0">
            <div className="w-[180px] shrink-0 border-r border-ink-100 px-3 py-3">
              <p className="truncate font-ui text-[13px] font-medium text-ink-900">{hotel.companyName}</p>
              <p className="font-ui text-[10px] uppercase tracking-[0.14em] text-ink-400">
                {hotel.shifts.length} {hotel.shifts.length === 1 ? "dienst" : "diensten"}
              </p>
            </div>
            <div className="relative flex-1">
              {/* hour gridlines */}
              <div className="absolute inset-0 flex">
                {hours.slice(0, -1).map((h) => (
                  <div key={h} className="flex-1 border-r border-ink-100/70" />
                ))}
              </div>
              {markerPct != null && (
                <div
                  className="absolute top-0 bottom-0 z-10 w-px bg-red-500"
                  style={{ left: `${markerPct}%` }}
                  aria-hidden
                />
              )}
              {/* shift blocks */}
              <div className="relative space-y-1.5 py-2 pr-2">
                {hotel.shifts.map((s) => {
                  const start = amsHourFloat(s.row.startsAt);
                  const end = Math.max(start + 0.5, amsHourFloat(s.row.endsAt));
                  const left = clampPct(((start - START_HOUR) / SPAN) * 100);
                  const width = clampPct(((end - start) / SPAN) * 100);
                  const meta = HEALTH_META[s.fill.health];
                  const { ratio, sub } = blockLabel(s);
                  const names = chefNamesByShift[s.row.id] ?? [];
                  return (
                    <div key={s.row.id} className="relative h-12">
                      <Link
                        href={`/admin/business/shifts/${s.row.id}`}
                        style={{ left: `${left}%`, width: `${Math.max(width, 9)}%` }}
                        className={`absolute top-0 flex h-12 flex-col justify-center overflow-hidden rounded-md border px-2 py-1 ${meta.badge} border-current/10 hover:ring-2 hover:ring-burgundy/30`}
                        title={`${dagdeelLabel(s.dagdeel)} · ${s.row.roleNeeded} · ${ratio}`}
                      >
                        <span className="flex items-center gap-1 truncate font-ui text-[11px] font-semibold">
                          <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                          {dagdeelLabel(s.dagdeel)} <span className="font-normal opacity-70">{ratio}</span>
                        </span>
                        <span className="truncate text-[10px] opacity-80">
                          {names.length > 0 ? names.join(", ") : sub}
                        </span>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
