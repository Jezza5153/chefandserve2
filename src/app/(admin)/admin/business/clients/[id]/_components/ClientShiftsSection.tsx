/**
 * Recente & aankomende shifts — owner-side drill-down on the klant detail (K2).
 * Replaces the "Plaatsings-geschiedenis / Aankomende shifts" promises from the old
 * static Binnenkort card with the live list, each row linking to the shift, plus a
 * link into the global shifts list scoped to this klant.
 */
import Link from "next/link";

import type { ClientRecentShift } from "@/lib/domain/client-history";
import { formatShiftRole } from "@/lib/labels";

const STATUS_TONE: Record<string, string> = {
  request: "bg-bg-gray text-ink-500",
  open: "bg-amber-100 text-amber-700",
  filled: "bg-emerald-100 text-emerald-700",
  completed: "bg-blue-100 text-blue-700",
  cancelled: "bg-red-100 text-red-700",
};
const STATUS_LABEL: Record<string, string> = {
  request: "Aanvraag",
  open: "Open",
  filled: "Bemand",
  completed: "Afgerond",
  cancelled: "Geannuleerd",
};

function fmt(start: Date, end: Date): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })} · ${s.toLocaleTimeString(
    "nl-NL",
    { hour: "2-digit", minute: "2-digit" },
  )}–${e.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
}

export function ClientShiftsSection({
  shifts,
  clientId,
}: {
  shifts: ClientRecentShift[];
  clientId: string;
}) {
  return (
    <div className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-lg text-ink-900">Recente &amp; aankomende shifts</h2>
        <Link
          href={`/admin/business/shifts?clientId=${clientId}`}
          className="font-ui text-[11px] uppercase tracking-[0.15em] text-burgundy underline-offset-4 hover:underline"
        >
          Alle shifts van deze klant →
        </Link>
      </div>

      {shifts.length === 0 ? (
        <p className="mt-3 text-sm text-ink-500">
          Nog geen shifts voor deze klant.{" "}
          <Link href="/admin/business/shifts/new" className="text-burgundy underline-offset-4 hover:underline">
            Maak de eerste dienst aan →
          </Link>
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-ink-200">
          {shifts.map((s) => (
            <li key={s.shiftId} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <Link
                  href={`/admin/business/shifts/${s.shiftId}`}
                  className="text-sm text-ink-900 hover:text-burgundy hover:underline"
                >
                  {fmt(s.startsAt, s.endsAt)}
                </Link>
                <p className="mt-0.5 truncate text-xs text-ink-500">
                  {formatShiftRole(s.roleNeeded)}
                  {s.city ? ` · ${s.city}` : ""}
                  {s.chefNames.length > 0 ? ` · ${s.chefNames.join(", ")}` : ""}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${
                  STATUS_TONE[s.status] ?? "bg-bg-gray text-ink-500"
                }`}
              >
                {STATUS_LABEL[s.status] ?? s.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
