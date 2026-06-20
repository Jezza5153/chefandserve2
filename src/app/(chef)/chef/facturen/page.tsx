/**
 * /chef/facturen — CHEF-PR7 ZZP self-billing. A freelance chef invoices Chef &
 * Serve for shifts worked: see what's goedgekeurd-en-klaar-om-te-factureren (from
 * the payout pipeline), submit an invoice (amount + period + optional PDF), and
 * track status. Payroll chefs don't self-invoice → they see a short note.
 * Auth IS the lookup (session → chefs.userId).
 */
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import { createChefInvoice, listChefInvoices } from "@/lib/domain/chef-invoices";
import { getChefPaymentStatus } from "@/lib/domain/chef-payments";
import { formatEuro } from "@/lib/hours-labels";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n/locales";
import { type Dict } from "@/lib/i18n/get-dict";
import { requireAuth } from "@/lib/permissions";
import { chefInvoiceKey, getUploadUrl, isAllowedFile, r2IsConfigured } from "@/lib/r2";

import { InvoiceUploadField } from "./InvoiceUploadField";

export const metadata = { title: "Facturen", robots: { index: false } };
export const dynamic = "force-dynamic";

const LABEL = "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy";

function statusChip(status: string, t: Dict): { label: string; cls: string } {
  switch (status) {
    case "paid":
      return { label: t.status.paid, cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "approved":
      return { label: t.status.approved, cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "submitted":
      return { label: t.status.pending, cls: "bg-amber-50 text-amber-700 border-amber-200" };
    case "rejected":
      return { label: t.status.rejected, cls: "bg-burgundy/10 text-burgundy border-burgundy/20" };
    default:
      return { label: t.status.concept, cls: "bg-ink-100 text-ink-500 border-ink-200" };
  }
}

async function submitInvoice(formData: FormData) {
  "use server";
  const session = await requireAuth();
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.userId, session.user.id) });
  if (!chef) redirect("/chef/facturen?ok=error");
  const euro = parseFloat(String(formData.get("amountEuro") ?? "").replace(",", "."));
  if (!Number.isFinite(euro) || euro <= 0 || euro > 50000) {
    redirect("/chef/facturen?ok=error");
  }
  const res = await createChefInvoice({
    chefId: chef.id,
    actorUserId: session.user.id,
    amountCents: Number.isFinite(euro) ? Math.round(euro * 100) : 0,
    periodFrom: String(formData.get("periodFrom") ?? "") || null,
    periodTo: String(formData.get("periodTo") ?? "") || null,
    reference: String(formData.get("reference") ?? ""),
    note: String(formData.get("note") ?? ""),
    invoiceR2Key: String(formData.get("invoiceR2Key") ?? "") || null,
    submit: true,
  });
  redirect(`/chef/facturen?ok=${res.ok ? "submitted" : "error"}`);
}

async function requestInvoiceUpload(args: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<{ ok: true; uploadUrl: string; documentId: string } | { ok: false; error: string }> {
  "use server";
  const session = await requireAuth();
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.userId, session.user.id) });
  if (!chef) return { ok: false, error: "Geen chef-profiel." };
  if (!r2IsConfigured()) return { ok: false, error: "Uploads zijn nog niet beschikbaar." };
  const allowed = isAllowedFile(args.mimeType, args.sizeBytes);
  if (!allowed.ok) return { ok: false, error: allowed.reason };
  const r2Key = chefInvoiceKey(chef.id, crypto.randomUUID(), args.filename);
  const { url } = await getUploadUrl(r2Key, args.mimeType);
  return { ok: true, uploadUrl: url, documentId: r2Key };
}

export default async function ChefFacturenPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const sp = await searchParams;
  const { dict: t } = await getI18n();
  const session = await requireAuth("/chef/facturen");
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.userId, session.user.id) });
  if (!chef) notFound();

  const isZzp = chef.employmentType === "zzp" || chef.employmentType === "both";

  if (!isZzp) {
    return (
      <div>
        <p className={LABEL}>{t.invoices.eyebrow}</p>
        <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">{t.invoices.eyebrow}</h1>
        <p className="mt-6 rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          {t.invoices.nonZzpBody}
        </p>
      </div>
    );
  }

  const [payments, invoices] = await Promise.all([
    getChefPaymentStatus(chef.id),
    listChefInvoices(chef.id),
  ]);
  const readyBucket = payments.buckets.find((b) => b.stage === "approved");
  const inputCls =
    "mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-burgundy focus:outline-none";

  return (
    <div className="pb-24">
      <p className={LABEL}>{t.invoices.eyebrow}</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">{t.invoices.title}</h1>
      <p className="mt-3 max-w-prose text-sm text-ink-700">{t.invoices.intro}</p>

      {sp.ok === "submitted" ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {t.invoices.okSubmitted}
        </p>
      ) : sp.ok === "error" ? (
        <p className="mt-4 rounded-lg border border-burgundy/20 bg-burgundy/10 p-3 text-sm text-burgundy">
          {t.common.amountError}
        </p>
      ) : null}

      {/* Ready to invoice (from the payout pipeline's 'approved' bucket) */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <p className={LABEL}>{t.invoices.readyTitle}</p>
        {readyBucket && readyBucket.amountCents > 0 ? (
          <p className="mt-1 text-sm text-ink-700">
            <strong>{formatEuro(readyBucket.amountCents)}</strong>
            {fill(t.invoices.readyBody, {
              count: readyBucket.count,
              unit: readyBucket.count === 1 ? t.common.shift : t.common.shifts,
            })}
          </p>
        ) : (
          <p className="mt-1 text-sm text-ink-500">{t.invoices.readyEmpty}</p>
        )}
      </section>

      {/* Submit an invoice */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <p className={LABEL}>{t.invoices.submitTitle}</p>
        <form action={submitInvoice} className="mt-3 space-y-3">
          <label className="block">
            <span className="text-sm text-ink-800">{t.invoices.amountField}</span>
            <input name="amountEuro" type="text" inputMode="decimal" required placeholder={t.invoices.amountPlaceholder} className={inputCls} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm text-ink-800">{t.invoices.periodFrom}</span>
              <input name="periodFrom" type="date" className={inputCls} />
            </label>
            <label className="block">
              <span className="text-sm text-ink-800">{t.invoices.periodTo}</span>
              <input name="periodTo" type="date" className={inputCls} />
            </label>
          </div>
          <label className="block">
            <span className="text-sm text-ink-800">{t.invoices.referenceField}</span>
            <input name="reference" type="text" maxLength={120} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-sm text-ink-800">{t.common.noteOptional}</span>
            <textarea name="note" rows={2} maxLength={500} className={inputCls} />
          </label>
          <InvoiceUploadField requestUpload={requestInvoiceUpload} />
          <button className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy/90">
            {t.invoices.submitInvoice}
          </button>
        </form>
      </section>

      {/* Own invoices */}
      {invoices.length > 0 ? (
        <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
          <p className={LABEL}>{t.invoices.yourInvoices}</p>
          <ul className="mt-3 divide-y divide-ink-100">
            {invoices.map((inv) => {
              const chip = statusChip(inv.status, t);
              return (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 text-ink-700">
                    {formatEuro(inv.amountCents)}
                    {inv.reference ? <span className="text-ink-400"> · {inv.reference}</span> : null}
                    {inv.decisionNote && inv.status === "rejected" ? (
                      <span className="block text-xs text-burgundy">{inv.decisionNote}</span>
                    ) : null}
                  </span>
                  <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${chip.cls}`}>
                    {chip.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
