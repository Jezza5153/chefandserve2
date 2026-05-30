/**
 * "Beschikbare chefs niet ingepland" — the Day-view supply table: chef · niveau ·
 * vaardigheden · locatie. Read-only: each chef name links to Chef 360. Date-level
 * (the section title implies "vandaag, niet ingepland"; no hourly-window claim).
 */

import Link from "next/link";

import { Icon } from "@/components/admin/icons";

export type ChefRow = {
  id: string;
  fullName: string;
  niveau: string | null;
  skills: string[];
  locatie: string | null;
};

const TH = "px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.2em] text-burgundy";

export function BeschikbareChefsTable({ rows, total }: { rows: ChefRow[]; total: number }) {
  return (
    <section className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-[0_1px_2px_rgba(41,41,42,0.04)]">
      <div className="flex items-center gap-1.5 border-b border-ink-100 px-4 py-3">
        <Icon name="users" className="h-4 w-4 text-burgundy" />
        <h2 className="font-ui text-[11px] uppercase tracking-[0.2em] text-burgundy">Beschikbare chefs niet ingepland ({total})</h2>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-ink-500">Geen vrije chefs op deze datum.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-bg-gray text-left">
              <th className={TH}>Chef</th>
              <th className={`${TH} px-2`}>Niveau</th>
              <th className={`${TH} px-2`}>Vaardigheden</th>
              <th className={`${TH} px-2`}>Locatie</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((c) => (
              <tr key={c.id} className="h-12 transition-colors hover:bg-bg-gray">
                <td className="px-4 align-middle">
                  <Link
                    href={`/admin/business/chefs/${c.id}`}
                    className="flex items-center gap-2 rounded text-ink-900 hover:text-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burgundy"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span className="block max-w-[180px] truncate font-ui text-[13px]">{c.fullName}</span>
                  </Link>
                </td>
                <td className="whitespace-nowrap px-2 align-middle text-ink-700">{c.niveau ?? "—"}</td>
                <td className="px-2 align-middle">
                  {c.skills.length === 0 ? (
                    <span className="text-ink-300">—</span>
                  ) : (
                    <span className="flex items-center gap-1 overflow-hidden">
                      {c.skills.slice(0, 2).map((s) => (
                        <span key={s} className="whitespace-nowrap rounded-full bg-bg-gray px-2 py-0.5 font-ui text-[10px] text-ink-600">
                          {s}
                        </span>
                      ))}
                      {c.skills.length > 2 && <span className="shrink-0 font-ui text-[10px] text-ink-400">+{c.skills.length - 2}</span>}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 align-middle text-ink-600">{c.locatie ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {total > rows.length && (
        <Link href="/admin/business/chefs" className="flex items-center gap-1 border-t border-ink-100 px-4 py-2.5 font-ui text-[11px] font-medium text-burgundy hover:underline">
          Bekijk alle beschikbare chefs
          <Icon name="arrow-right" className="h-3.5 w-3.5" />
        </Link>
      )}
    </section>
  );
}
