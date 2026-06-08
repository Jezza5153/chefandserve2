/**
 * /client/invoices/[id] — a single invoice, read-only.
 *
 * Ownership is the auth lookup (session.user.id → clients.userId). We notFound()
 * unless the invoice exists AND belongs to this klant's client AND is one the
 * klant is allowed to see (status IN sent/paid/credit) — draft/void are internal.
 *
 * No raw status reaches the UI: invoiceStatusView(status,"klant") gives the
 * human label + tone + the "wat gebeurt er nu?" next-step line.
 * This page has no buttons/actions — it is purely a view.
 */

import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/db/client";
import { clients, invoiceLines, invoices } from "@/lib/db/schema";
import { formatEuro } from "@/lib/hours-labels";
import { invoiceStatusView, invoiceToneClasses } from "@/lib/invoice-labels";
import { requireAuth } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const VISIBLE_STATUSES = new Set(["sent", "paid", "credit"]);

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireAuth(`/client/invoices/${id}`);
  const client = await db.query.clients.findFirst({
    where: eq(clients.userId, session.user.id),
  });
  if (!client) return { title: "Factuur" };
  const invoice = await db.query.invoices.findFirst({
    where: eq(invoices.id, id),
  });
  if (
    !invoice ||
    invoice.clientId !== client.id ||
    !VISIBLE_STATUSES.has(invoice.status)
  ) {
    return { title: "Factuur" };
  }
  return { title: `Factuur ${invoice.number}` };
}

export default async function ClientInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireAuth(`/client/invoices/${id}`);

  const client = await db.query.clients.findFirst({
    where: eq(clients.userId, session.user.id),
  });
  if (!client) notFound();

  const invoice = await db.query.invoices.findFirst({
    where: eq(invoices.id, id),
  });
  if (
    !invoice ||
    invoice.clientId !== client.id ||
    !VISIBLE_STATUSES.has(invoice.status)
  ) {
    notFound();
  }

  const lines = await db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoice.id))
    .orderBy(asc(invoiceLines.shiftDate));

  const view = invoiceStatusView(invoice.status, "klant");

  return (
    <div>
      <Link
        href="/client/invoices"
        className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
      >
        ← Terug naar facturen
      </Link>

      <h1 className="mt-3 font-serif text-3xl text-ink-900 md:text-4xl">
        Factuur {invoice.number}
      </h1>

      {/* Status block — badge + "wat gebeurt er nu?" */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full border px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${invoiceToneClasses(
              view.tone,
            )}`}
          >
            {view.label}
          </span>
          <p className="font-serif text-lg text-ink-900">
            {formatEuro(invoice.totalCents)}
          </p>
        </div>
        {view.next ? (
          <p className="mt-2 text-sm text-ink-700">{view.next}</p>
        ) : null}
      </section>

      {/* Meta + bill-to */}
      <section className="mt-6 grid gap-6 rounded-lg border border-ink-200 bg-white p-5 sm:grid-cols-2">
        <div>
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Gegevens
          </p>
          <dl className="mt-2 space-y-1 text-sm text-ink-700">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Factuurnummer</dt>
              <dd className="text-ink-900">{invoice.number}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Factuurdatum</dt>
              <dd className="text-ink-900">{formatDate(invoice.issueDate)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Vervaldatum</dt>
              <dd className="text-ink-900">{formatDate(invoice.dueDate)}</dd>
            </div>
          </dl>
        </div>
        <div>
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Gefactureerd aan
          </p>
          <div className="mt-2 space-y-0.5 text-sm text-ink-700">
            <p className="text-ink-900">{invoice.billToName}</p>
            {invoice.billToAddress ? (
              <p className="whitespace-pre-line">{invoice.billToAddress}</p>
            ) : null}
            {invoice.billToKvk ? <p>KVK {invoice.billToKvk}</p> : null}
            {invoice.billToBtw ? <p>BTW {invoice.billToBtw}</p> : null}
          </div>
        </div>
      </section>

      {/* Line items + totals */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
          Regels
        </p>
        {lines.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">
            Geen regels op deze factuur.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-200">
            {lines.map((line) => (
              <li
                key={line.id}
                className="flex items-start justify-between gap-4 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="text-ink-900">{line.description}</p>
                  {line.chefName || line.shiftDate ? (
                    <p className="mt-0.5 text-xs text-ink-500">
                      {[
                        line.chefName,
                        line.shiftDate ? formatDate(line.shiftDate) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}
                </div>
                <p className="shrink-0 tabular-nums text-ink-900">
                  {formatEuro(line.amountCents)}
                </p>
              </li>
            ))}
          </ul>
        )}

        <dl className="mt-4 space-y-1.5 border-t border-ink-200 pt-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-500">Subtotaal (excl. btw)</dt>
            <dd className="tabular-nums text-ink-900">
              {formatEuro(invoice.subtotalCents)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-500">Btw {invoice.vatRateBps / 100}%</dt>
            <dd className="tabular-nums text-ink-900">
              {formatEuro(invoice.vatCents)}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-ink-200 pt-2 font-semibold">
            <dt className="text-ink-900">Totaal te voldoen</dt>
            <dd className="tabular-nums text-ink-900">
              {formatEuro(invoice.totalCents)}
            </dd>
          </div>
        </dl>
      </section>

      <Link
        href="/client/invoices"
        className="mt-6 inline-block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
      >
        ← Terug naar facturen
      </Link>
    </div>
  );
}
