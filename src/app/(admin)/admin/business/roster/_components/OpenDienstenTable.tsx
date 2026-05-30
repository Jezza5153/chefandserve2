/**
 * "Open diensten / aandacht nodig" — the day's not-yet-filled shifts as a triage
 * table: hotel · shift-tijd · dienst · nodig · reden · actie. Read + navigate: the
 * hotel cell and "Vul dienst" both link to the shift detail page (focusable). The
 * reden badge reuses the locked shiftVisuals tone vocabulary.
 */

import Link from "next/link";

import { Icon } from "@/components/admin/icons";
import { HEALTH_META } from "@/components/admin/shiftVisuals";

export type OpenDienstRow = {
  shiftId: string;
  hotel: string;
  start: string; // "17:00 – 21:00"
  dienst: string; // role label
  nodig: number;
  reden: "open" | "kritiek";
};

const TH = "px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.2em] text-burgundy";
const REDEN = {
  kritiek: { badge: HEALTH_META.critical.badge, label: "Kritiek" },
  open: { badge: HEALTH_META.underfilled.badge, label: "Open" },
};

export function OpenDienstenTable({ rows, total }: { rows: OpenDienstRow[]; total: number }) {
  return (
    <section className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-[0_1px_2px_rgba(41,41,42,0.04)]">
      <div className="flex items-center gap-1.5 border-b border-ink-100 px-4 py-3">
        <Icon name="alert-triangle" className="h-4 w-4 text-burgundy" />
        <h2 className="font-ui text-[11px] uppercase tracking-[0.2em] text-burgundy">Open diensten / aandacht nodig ({total})</h2>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-ink-500">Alle diensten zijn ingevuld.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-bg-gray text-left">
              <th className={TH}>Hotel</th>
              <th className={`${TH} px-2`}>Shift</th>
              <th className={`${TH} px-2`}>Dienst</th>
              <th className={`${TH} px-2 text-center`}>Nodig</th>
              <th className={`${TH} px-2`}>Reden</th>
              <th className={`${TH} text-right`}>Actie</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((r) => (
              <tr key={r.shiftId} className="transition-colors hover:bg-bg-gray">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/admin/business/shifts/${r.shiftId}`}
                    className="block max-w-[180px] truncate rounded text-ink-900 hover:text-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burgundy"
                  >
                    {r.hotel}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 tabular-nums text-ink-600">{r.start}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-ink-700">{r.dienst}</td>
                <td className="px-2 py-2.5 text-center tabular-nums text-ink-700">{r.nodig}</td>
                <td className="px-2 py-2.5">
                  <span className={`inline-block rounded-full px-2 py-0.5 font-ui text-[9px] font-semibold uppercase tracking-wider ${REDEN[r.reden].badge}`}>
                    {REDEN[r.reden].label}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/admin/business/shifts/${r.shiftId}`} className="font-ui text-[12px] font-medium text-burgundy hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burgundy">
                    Vul dienst
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {total > rows.length && (
        <Link href="/admin/business/roster?view=day&filter=open" className="flex items-center gap-1 border-t border-ink-100 px-4 py-2.5 font-ui text-[11px] font-medium text-burgundy hover:underline">
          Bekijk alle open diensten
          <Icon name="arrow-right" className="h-3.5 w-3.5" />
        </Link>
      )}
    </section>
  );
}
