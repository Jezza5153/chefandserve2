/**
 * "Maarten's daglijst" (PR-INTEL-P7) — proactive relationship signals, not
 * operational staffing. Who's drifting out of view and is worth keeping warm:
 * good chefs gone quiet + klanten who haven't booked in a while. Reads the
 * relationship-health aggregates in src/lib/domain/intel.ts. Every row links
 * straight to the detail page where Maarten can act (call, log contact, book).
 */
import Link from "next/link";

import type {
  ProvenOpportunity,
  QuietClient,
  ReactivationChef,
} from "@/lib/domain/intel";
import { formatShiftRole } from "@/lib/labels";

export function DaglijstCard({
  opportunities,
  reactivationChefs,
  quietClients,
}: {
  opportunities: ProvenOpportunity[];
  reactivationChefs: ReactivationChef[];
  quietClients: QuietClient[];
}) {
  if (
    opportunities.length === 0 &&
    reactivationChefs.length === 0 &&
    quietClients.length === 0
  )
    return null;
  return (
    <section className="rounded-lg border border-ink-200 bg-white p-6">
      <h2 className="font-serif text-lg text-ink-900">Maarten&rsquo;s daglijst</h2>
      <p className="mt-1 text-xs text-ink-500">
        Relatie-signalen — wie raakt uit beeld en is het waard om warm te houden,
        en waar een bewezen match een open dienst kan vullen.
      </p>

      {/* Kansen — proven chef × open dienst, the highest-signal "do dit nu" */}
      {opportunities.length > 0 && (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50/50 p-4">
          <h3 className="font-ui text-[11px] uppercase tracking-[0.18em] text-emerald-800">
            Kansen — bewezen chef voor een open dienst ({opportunities.length})
          </h3>
          <ul className="mt-2 space-y-1.5">
            {opportunities.map((o) => (
              <li key={`${o.shiftId}:${o.chefId}`} className="text-sm">
                <Link
                  href={`/admin/business/shifts/${o.shiftId}`}
                  className="text-ink-900 hover:text-burgundy hover:underline"
                >
                  <strong>{o.chefName}</strong> → {o.companyName}
                </Link>
                <span className="text-ink-500">
                  {" · "}
                  {formatShiftRole(o.roleNeeded)} · {formatWhen(o.startsAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <Column
          title={`Chefs om te bellen (${reactivationChefs.length})`}
          empty="Iedereen recent ingezet."
          rows={reactivationChefs.map((c) => ({
            id: c.chefId,
            href: `/admin/business/chefs/${c.chefId}`,
            name: c.fullName,
            meta: `${c.daysSince}d stil · ${c.completedShifts}×`,
          }))}
        />
        <Column
          title={`Klanten om te benaderen (${quietClients.length})`}
          empty="Alle klanten recent geboekt."
          rows={quietClients.map((c) => ({
            id: c.clientId,
            href: `/admin/business/clients/${c.clientId}`,
            name: c.companyName,
            meta: `${c.daysSince}d stil · ${c.totalShifts}×`,
          }))}
        />
      </div>
    </section>
  );
}

function formatWhen(d: Date): string {
  return d.toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function Column({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: Array<{ id: string; href: string; name: string; meta: string }>;
}) {
  return (
    <div>
      <h3 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-ink-500">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-baseline justify-between gap-3">
              <Link
                href={r.href}
                className="truncate text-sm text-ink-900 hover:text-burgundy hover:underline"
              >
                {r.name}
              </Link>
              <span className="shrink-0 font-ui text-[11px] tabular-nums text-ink-500">
                {r.meta}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
