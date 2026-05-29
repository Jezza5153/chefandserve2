/**
 * "Beschikbare chefs niet ingepland" — the Day-view supply table: chef ·
 * vaardigheden · beschikbaar · locatie · voorkeur. Read-only: each chef links to
 * Chef 360. Date-level availability (we show "Hele dag" — no hourly-window claim).
 */

import Link from "next/link";

import { Icon } from "@/components/admin/icons";

export type ChefRow = {
  id: string;
  fullName: string;
  skills: string[];
  locatie: string | null;
  voorkeur: string | null;
};

export function BeschikbareChefsTable({ rows, total }: { rows: ChefRow[]; total: number }) {
  return (
    <section className="rounded-lg border border-ink-200 bg-white">
      <div className="flex items-center gap-1.5 border-b border-ink-100 px-4 py-3">
        <Icon name="users" className="h-4 w-4 text-burgundy" />
        <h2 className="font-ui text-[11px] uppercase tracking-[0.16em] text-burgundy">
          Beschikbare chefs niet ingepland ({total})
        </h2>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-ink-400">Geen vrije chefs op deze datum.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-left font-ui text-[10px] uppercase tracking-wider text-ink-400">
              <th className="px-4 py-2 font-medium">Chef</th>
              <th className="px-2 py-2 font-medium">Vaardigheden</th>
              <th className="px-2 py-2 font-medium">Beschikbaar</th>
              <th className="px-2 py-2 font-medium">Locatie</th>
              <th className="px-4 py-2 font-medium">Voorkeur</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-ink-50 last:border-0">
                <td className="px-4 py-2">
                  <Link href={`/admin/business/chefs/${c.id}`} className="flex items-center gap-2 text-ink-900 hover:text-burgundy">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span className="truncate font-ui text-[13px]">{c.fullName}</span>
                  </Link>
                </td>
                <td className="px-2 py-2">
                  <span className="flex flex-wrap gap-1">
                    {c.skills.length === 0 ? (
                      <span className="text-ink-400">—</span>
                    ) : (
                      c.skills.slice(0, 3).map((s) => (
                        <span key={s} className="rounded-full bg-bg-gray px-2 py-0.5 font-ui text-[10px] text-ink-600">
                          {s}
                        </span>
                      ))
                    )}
                  </span>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-ink-500">Hele dag</td>
                <td className="truncate px-2 py-2 text-ink-600">{c.locatie ?? "—"}</td>
                <td className="truncate px-4 py-2 text-ink-600">{c.voorkeur ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {total > rows.length && (
        <Link href="/admin/business/chefs" className="flex items-center gap-1 border-t border-ink-100 px-4 py-2 font-ui text-[11px] font-medium text-burgundy hover:underline">
          Bekijk alle beschikbare chefs
          <Icon name="arrow-right" className="h-3.5 w-3.5" />
        </Link>
      )}
    </section>
  );
}
