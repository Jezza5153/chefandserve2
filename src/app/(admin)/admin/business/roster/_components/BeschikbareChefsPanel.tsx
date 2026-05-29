/**
 * "Beschikbaar maar niet ingepland" — the Day-view supply rail. Read-only: a
 * chef row links to Chef 360. Date-level availability (no hourly-window claim).
 * Sharper than a generic "12 available": shows the skill split so the operator
 * sees WHICH chefs are free.
 */

import Link from "next/link";

import { Icon } from "@/components/admin/icons";
import type { AvailableChefRow } from "@/lib/domain/roster-intel";

export function BeschikbareChefsPanel({
  count,
  bySkill,
  chefs,
}: {
  count: number;
  bySkill: Record<string, number>;
  chefs: AvailableChefRow[];
}) {
  const skills = Object.entries(bySkill)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <section className="rounded-lg border border-ink-200 bg-white">
      <div className="border-b border-ink-100 px-4 py-3">
        <p className="flex items-center gap-1.5 font-ui text-[11px] uppercase tracking-[0.16em] text-ink-500">
          <Icon name="users" className="h-4 w-4" />
          Beschikbaar, niet ingepland
        </p>
        <p className="mt-1 font-serif text-2xl text-ink-900">{count}</p>
        {skills.length > 0 && (
          <p className="mt-1 text-[12px] text-ink-500">
            {skills.map(([s, n]) => `${n} ${s}`).join(" · ")}
          </p>
        )}
      </div>
      {chefs.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-ink-400">
          Geen vrije chefs op deze datum.
        </p>
      ) : (
        <ul className="max-h-[520px] divide-y divide-ink-100 overflow-y-auto">
          {chefs.map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/business/chefs/${c.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-gray"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-burgundy/10 font-ui text-[11px] font-semibold text-burgundy">
                  {c.fullName
                    .split(" ")
                    .map((p) => p[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-ui text-[13px] text-ink-900">{c.fullName}</span>
                  <span className="block truncate text-[11px] text-ink-500">
                    {[c.city, (c.skills ?? []).join(", ")].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                <Icon name="arrow-right" className="h-3.5 w-3.5 shrink-0 text-ink-300" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
