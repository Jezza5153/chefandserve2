/**
 * "Open diensten / aandacht nodig" — the day's not-yet-filled shifts as a triage
 * table: hotel · shift-tijd · dienst (rol) · nodig (open plekken) · reden · actie.
 * Read + navigate: "Vul dienst" links to the shift detail page (where you propose).
 */

import Link from "next/link";

import { Icon } from "@/components/admin/icons";

export type OpenDienstRow = {
  shiftId: string;
  hotel: string;
  start: string; // "17:00 – 21:00"
  dienst: string; // role label
  nodig: number;
  reden: "open" | "kritiek";
};

export function OpenDienstenTable({ rows, total }: { rows: OpenDienstRow[]; total: number }) {
  return (
    <section className="rounded-lg border border-ink-200 bg-white">
      <div className="flex items-center gap-1.5 border-b border-ink-100 px-4 py-3">
        <Icon name="alert-triangle" className="h-4 w-4 text-burgundy" />
        <h2 className="font-ui text-[11px] uppercase tracking-[0.16em] text-burgundy">
          Open diensten / aandacht nodig ({total})
        </h2>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-ink-400">Alle diensten zijn ingevuld.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-left font-ui text-[10px] uppercase tracking-wider text-ink-400">
              <th className="px-4 py-2 font-medium">Hotel</th>
              <th className="px-2 py-2 font-medium">Shift</th>
              <th className="px-2 py-2 font-medium">Dienst</th>
              <th className="px-2 py-2 text-center font-medium">Nodig</th>
              <th className="px-2 py-2 font-medium">Reden</th>
              <th className="px-4 py-2 text-right font-medium">Actie</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.shiftId} className="border-b border-ink-50 last:border-0">
                <td className="truncate px-4 py-2 text-ink-900">{r.hotel}</td>
                <td className="whitespace-nowrap px-2 py-2 tabular-nums text-ink-600">{r.start}</td>
                <td className="px-2 py-2 text-ink-700">{r.dienst}</td>
                <td className="px-2 py-2 text-center tabular-nums text-ink-700">{r.nodig}</td>
                <td className="px-2 py-2">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 font-ui text-[9px] font-semibold uppercase tracking-wider ${
                      r.reden === "kritiek" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {r.reden === "kritiek" ? "Kritiek" : "Open"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/business/shifts/${r.shiftId}`} className="font-ui text-[12px] font-medium text-burgundy hover:underline">
                    Vul dienst
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {total > rows.length && (
        <Link href="/admin/business/roster?view=day&filter=open" className="flex items-center gap-1 border-t border-ink-100 px-4 py-2 font-ui text-[11px] font-medium text-burgundy hover:underline">
          Bekijk alle open diensten
          <Icon name="arrow-right" className="h-3.5 w-3.5" />
        </Link>
      )}
    </section>
  );
}
