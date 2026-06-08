/**
 * /admin/business/invoices/[id] — one invoice (PR-INVOICE-A5).
 * View the snapshot + lines + totals, and act: send → mark paid, or void.
 * Buttons are gated by status; the domain re-checks atomically.
 */
import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/db/client";
import { invoiceLines, invoices } from "@/lib/db/schema";
import { formatEuro } from "@/lib/hours-labels";
import { invoiceStatusView, invoiceToneClasses } from "@/lib/invoice-labels";
import { requirePermission } from "@/lib/permissions";

import { markPaidAction, sendInvoiceAction, voidInvoiceAction } from "../actions";

export const metadata = { title: "Factuur", robots: { index: false } };
export const dynamic = "force-dynamic";

function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requirePermission("invoices", "read");
  const { id } = await params;
  const sp = await searchParams;

  const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!inv) notFound();

  const lines = await db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, inv.id))
    .orderBy(asc(invoiceLines.shiftDate));

  const view = invoiceStatusView(inv.status, "admin");

  const flashOk =
    sp.ok === "created"
      ? "✓ Factuur aangemaakt als concept. Controleer en verstuur naar de klant."
      : sp.ok === "exists"
        ? "Deze factuur bestond al voor die periode."
        : sp.ok === "sent"
          ? "✓ Factuur verstuurd naar de klant."
          : sp.ok === "paid"
            ? "✓ Gemarkeerd als betaald."
            : sp.ok === "voided"
              ? "✓ Factuur geannuleerd. De uren zijn weer vrij om te factureren."
              : null;
  const flashErr = sp.error
    ? sp.error === "no_recipient"
      ? "Geen e-mailadres bij deze klant — vul eerst een (facturatie-)e-mail in."
      : sp.error === "not_sendable"
        ? "Deze factuur kan niet meer verstuurd worden."
        : sp.error === "not_sent_or_already_paid"
          ? "Alleen een verstuurde factuur kan op betaald."
          : `Actie mislukt (${sp.error}).`
    : null;

  const canSend = inv.status === "draft" || inv.status === "sent";
  const canPay = inv.status === "sent";
  const canVoid = inv.status === "draft" || inv.status === "sent";

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/business/invoices" className="text-sm text-burgundy hover:underline">
        ← Alle facturen
      </Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl text-ink-900">Factuur {inv.number}</h1>
          <p className="mt-1 text-sm text-ink-500">{inv.billToName}</p>
        </div>
        <span
          className={`mt-2 shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-wider ${invoiceToneClasses(
            view.tone,
          )}`}
        >
          {view.label}
        </span>
      </div>

      {flashOk ? (
        <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {flashOk}
        </p>
      ) : null}
      {flashErr ? (
        <p className="mt-4 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
          {flashErr}
        </p>
      ) : null}

      {/* Wat gebeurt er nu? */}
      <p className="mt-4 rounded-lg border border-ink-200 bg-bg-gray px-4 py-3 text-sm text-ink-700">
        <span className="font-medium text-ink-900">Wat gebeurt er nu? </span>
        {view.next}
      </p>

      {/* Meta + bill-to */}
      <section className="mt-6 grid gap-6 rounded-lg border border-ink-200 bg-white p-6 sm:grid-cols-2">
        <div>
          <h2 className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Gegevens
          </h2>
          <dl className="mt-2 space-y-1 text-sm text-ink-700">
            <Row k="Periode" v={`${fmtDate(inv.periodStart)} – ${fmtDate(inv.periodEnd)}`} />
            <Row k="Factuurdatum" v={fmtDate(inv.issueDate)} />
            <Row k="Vervaldatum" v={fmtDate(inv.dueDate)} />
            {inv.sentAt ? <Row k="Verstuurd" v={fmtDate(inv.sentAt)} /> : null}
            {inv.paidAt ? <Row k="Betaald" v={fmtDate(inv.paidAt)} /> : null}
          </dl>
        </div>
        <div>
          <h2 className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Aan
          </h2>
          <div className="mt-2 space-y-0.5 text-sm text-ink-700">
            <p className="font-medium text-ink-900">{inv.billToName}</p>
            {inv.billToAddress ? <p>{inv.billToAddress}</p> : null}
            {inv.billToEmail ? <p>{inv.billToEmail}</p> : null}
            {inv.billToKvk ? <p>KVK {inv.billToKvk}</p> : null}
            {inv.billToBtw ? <p>BTW {inv.billToBtw}</p> : null}
          </div>
        </div>
      </section>

      {/* Lines */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white p-6">
        <h2 className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
          Regels
        </h2>
        <ul className="mt-3 divide-y divide-ink-100">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 text-ink-700">{l.description}</span>
              <span className="shrink-0 font-mono text-ink-900">{formatEuro(l.amountCents)}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1 border-t border-ink-200 pt-4 text-sm">
          <Row k="Subtotaal (excl. btw)" v={formatEuro(inv.subtotalCents)} mono />
          <Row k={`Btw ${Math.round(inv.vatRateBps / 100)}%`} v={formatEuro(inv.vatCents)} mono />
          <div className="flex items-center justify-between pt-1 font-semibold text-ink-900">
            <dt>Totaal</dt>
            <dd className="font-mono">{formatEuro(inv.totalCents)}</dd>
          </div>
        </dl>
      </section>

      {/* Actions */}
      {canSend || canPay || canVoid ? (
        <section className="mt-6 flex flex-wrap items-center gap-3">
          {canSend ? (
            <form action={sendInvoiceAction}>
              <input type="hidden" name="invoiceId" value={inv.id} />
              <button
                type="submit"
                className="rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
              >
                {inv.status === "sent" ? "Opnieuw versturen" : "Verstuur naar klant"}
              </button>
            </form>
          ) : null}
          {canPay ? (
            <form action={markPaidAction}>
              <input type="hidden" name="invoiceId" value={inv.id} />
              <button
                type="submit"
                className="rounded-full border border-emerald-300 bg-emerald-50 px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-800 hover:bg-emerald-100"
              >
                Markeer als betaald
              </button>
            </form>
          ) : null}
          {canVoid ? (
            <form action={voidInvoiceAction} className="flex items-center gap-2">
              <input type="hidden" name="invoiceId" value={inv.id} />
              <input
                type="text"
                name="reason"
                placeholder="Reden (optioneel)"
                className="rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
              />
              <button
                type="submit"
                className="rounded-full border border-ink-300 px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-600 hover:border-burgundy hover:text-burgundy"
              >
                Annuleer
              </button>
            </form>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-500">{k}</dt>
      <dd className={mono ? "font-mono text-ink-900" : "text-ink-900"}>{v}</dd>
    </div>
  );
}
