/**
 * /client/invoices — the klant's invoice list (read-only).
 *
 * Ownership is the auth lookup (session.user.id → clients.userId). Klanten
 * NEVER see draft/void invoices — those are internal — so we filter to
 * status IN ('sent','paid','credit') in the query itself.
 *
 * No raw status reaches the UI: invoiceStatusView(status,"klant") gives the
 * human label + tone, and invoiceToneClasses renders the badge.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { clients, invoices } from "@/lib/db/schema";
import { formatEuro } from "@/lib/hours-labels";
import { invoiceStatusView, invoiceToneClasses } from "@/lib/invoice-labels";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Facturen" };
export const dynamic = "force-dynamic";

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function ClientInvoicesPage() {
  const session = await requireAuth("/client/invoices");
  const client = await db.query.clients.findFirst({
    where: eq(clients.userId, session.user.id),
  });
  if (!client) {
    return (
      <div>
        <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Facturen
        </p>
        <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
          Geen toegang
        </h1>
        <p className="mt-4 text-sm text-ink-700">
          Er is nog geen klant-profiel aan je account gekoppeld. Mail het
          kantoor en we zetten het voor je klaar.
        </p>
      </div>
    );
  }

  const rows = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.clientId, client.id),
        inArray(invoices.status, ["sent", "paid", "credit"]),
      ),
    )
    .orderBy(desc(invoices.issueDate))
    .limit(100);

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Facturen
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        Facturen
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        Een overzicht van je facturen. Klik op een factuur voor de details.
      </p>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          <p className="text-ink-700">Je hebt nog geen facturen.</p>
          <p className="mt-1">
            Zodra er een factuur klaarstaat, vind je &rsquo;m hier terug.
          </p>
        </div>
      ) : (
        <ul className="mt-8 space-y-2">
          {rows.map((inv) => {
            const view = invoiceStatusView(inv.status, "klant");
            return (
              <li key={inv.id}>
                <Link
                  href={`/client/invoices/${inv.id}`}
                  className="block rounded-lg border border-ink-200 bg-white p-4 transition hover:border-burgundy/40 hover:bg-burgundy/[0.02]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-serif text-base text-ink-900">
                        Factuur {inv.number}
                      </h3>
                      <p className="mt-0.5 text-xs text-ink-500">
                        Periode {formatDate(inv.periodStart)} –{" "}
                        {formatDate(inv.periodEnd)}
                      </p>
                      {inv.status === "sent" ? (
                        <p className="mt-1 text-xs text-ink-700">
                          Vervaldatum {formatDate(inv.dueDate)}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <p className="font-serif text-base text-ink-900">
                        {formatEuro(inv.totalCents)}
                      </p>
                      <span
                        className={`rounded-full border px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${invoiceToneClasses(
                          view.tone,
                        )}`}
                      >
                        {view.label}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
