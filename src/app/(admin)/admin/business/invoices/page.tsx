/**
 * /admin/business/invoices — facturatie (PR-INVOICE-A5).
 *
 * Owner surface (gated invoices.read) to:
 *   - Generate an invoice for a klant + period from admin_approved hours.
 *   - See every invoice with its status + "wat gebeurt er nu?".
 * Sending / mark-paid / void live on the per-invoice detail page.
 */
import { desc } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { clients, invoices } from "@/lib/db/schema";
import { formatEuro } from "@/lib/hours-labels";
import { invoiceStatusView, invoiceToneClasses } from "@/lib/invoice-labels";
import { requirePermission } from "@/lib/permissions";

import { generateInvoiceAction } from "./actions";

export const metadata = { title: "Facturen", robots: { index: false } };
export const dynamic = "force-dynamic";

function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requirePermission("invoices", "read");
  const sp = await searchParams;

  // Period default: last calendar month (same convention as payroll).
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    .toISOString()
    .slice(0, 10);
  const defaultEnd = new Date(now.getFullYear(), now.getMonth(), 0)
    .toISOString()
    .slice(0, 10);

  const clientRows = await db
    .select({ id: clients.id, companyName: clients.companyName })
    .from(clients)
    .orderBy(clients.companyName);

  const rows = await db
    .select()
    .from(invoices)
    .orderBy(desc(invoices.issueDate), desc(invoices.createdAt))
    .limit(100);

  const openCents = rows
    .filter((r) => r.status === "sent")
    .reduce((sum, r) => sum + r.totalCents, 0);

  const flashErr =
    sp.error === "empty"
      ? "Geen goedgekeurde uren in die periode voor deze klant."
      : sp.error === "missing-fields"
        ? "Kies een klant en vul beide datums in."
        : sp.error
          ? `Kon de factuur niet aanmaken (${sp.error}).`
          : null;

  return (
    <div className="mx-auto max-w-5xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Operations
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">Facturen</h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700">
        Maak een factuur uit goedgekeurde uren, verstuur die naar de klant en volg
        de betaling. Eén factuur per klant per periode — opnieuw aanmaken opent de
        bestaande.
      </p>

      {flashErr ? (
        <p className="mt-4 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
          {flashErr}
        </p>
      ) : null}

      {/* Generate */}
      <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
        <h2 className="font-serif text-xl text-ink-900">Nieuwe factuur</h2>
        <p className="mt-1 text-sm text-ink-500">
          Alle admin-goedgekeurde, nog niet gefactureerde uren in de periode komen
          op de factuur.
        </p>
        <form action={generateInvoiceAction} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
              Klant
            </span>
            <select
              name="clientId"
              required
              defaultValue=""
              className="min-w-[14rem] rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
            >
              <option value="" disabled>
                Kies een klant…
              </option>
              {clientRows.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
              Periode van
            </span>
            <input
              type="date"
              name="periodStart"
              required
              defaultValue={defaultStart}
              className="rounded border border-ink-200 bg-white px-3 py-2 font-mono text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
              Periode tot
            </span>
            <input
              type="date"
              name="periodEnd"
              required
              defaultValue={defaultEnd}
              className="rounded border border-ink-200 bg-white px-3 py-2 font-mono text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
            />
          </label>
          <button
            type="submit"
            className="rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
          >
            Maak factuur
          </button>
        </form>
      </section>

      {/* List */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-xl text-ink-900">Alle facturen</h2>
          {openCents > 0 ? (
            <p className="text-sm text-ink-500">
              Openstaand: <strong className="text-ink-900">{formatEuro(openCents)}</strong>
            </p>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <p className="mt-3 rounded-lg border border-ink-200 bg-white p-6 text-center text-sm text-ink-500">
            Nog geen facturen aangemaakt.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {rows.map((inv) => {
              const view = invoiceStatusView(inv.status, "admin");
              return (
                <li key={inv.id}>
                  <Link
                    href={`/admin/business/invoices/${inv.id}`}
                    className="flex items-start justify-between gap-3 rounded-lg border border-ink-200 bg-white p-4 hover:border-burgundy/40"
                  >
                    <div className="min-w-0">
                      <p className="font-serif text-base text-ink-900">
                        {inv.number} · {inv.billToName}
                      </p>
                      <p className="mt-1 text-xs text-ink-500">
                        {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)} ·{" "}
                        Vervalt {fmtDate(inv.dueDate)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-mono text-sm text-ink-900">
                        {formatEuro(inv.totalCents)}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${invoiceToneClasses(
                          view.tone,
                        )}`}
                      >
                        {view.label}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
