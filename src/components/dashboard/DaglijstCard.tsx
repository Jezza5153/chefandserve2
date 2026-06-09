/**
 * "Maarten's daglijst" (PR-INTEL-P7) — proactive relationship signals, not
 * operational staffing. Who's drifting out of view and is worth keeping warm:
 * good chefs gone quiet + klanten who haven't booked in a while. Reads the
 * relationship-health aggregates in src/lib/domain/intel.ts. Every row links
 * straight to the detail page where Maarten can act (call, log contact, book).
 */
import Link from "next/link";

import type { QuietClient, ReactivationChef } from "@/lib/domain/intel";

export function DaglijstCard({
  reactivationChefs,
  quietClients,
}: {
  reactivationChefs: ReactivationChef[];
  quietClients: QuietClient[];
}) {
  if (reactivationChefs.length === 0 && quietClients.length === 0) return null;
  return (
    <section className="rounded-lg border border-ink-200 bg-white p-6">
      <h2 className="font-serif text-lg text-ink-900">Maarten&rsquo;s daglijst</h2>
      <p className="mt-1 text-xs text-ink-500">
        Relatie-signalen — wie raakt uit beeld en is het waard om warm te houden.
        Niet de open diensten (dat is de planning), maar de mensen erachter.
      </p>
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
