/**
 * /chef/declaraties — CHEF-PR9b. The chef files vacation-money payouts + expense
 * (reiskosten) claims, and sees the status of their own requests. A REQUEST, not
 * an instant mutation — Maarten decides. Auth IS the lookup (session → chefs.userId).
 */
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import {
  createExpenseClaim,
  createVacationRequest,
  listChefExpenseClaims,
  listChefVacationRequests,
} from "@/lib/domain/chef-requests";
import { getChefVacationEstimate } from "@/lib/domain/chef-payments";
import { formatEuro } from "@/lib/hours-labels";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n/locales";
import { type Dict } from "@/lib/i18n/get-dict";
import { requireAuth } from "@/lib/permissions";
import { chefExpenseReceiptKey, getUploadUrl, isAllowedFile, r2IsConfigured } from "@/lib/r2";

import { ReceiptUploadField } from "./ReceiptUploadField";

export const metadata = { title: "Declaraties", robots: { index: false } };
export const dynamic = "force-dynamic";

const LABEL = "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy";

function statusChip(status: string, t: Dict): { label: string; cls: string } {
  switch (status) {
    case "approved":
      return { label: t.status.approved, cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "rejected":
      return { label: t.status.rejected, cls: "bg-burgundy/10 text-burgundy border-burgundy/20" };
    case "cancelled":
      return { label: t.status.cancelled, cls: "bg-ink-100 text-ink-500 border-ink-200" };
    default:
      return { label: t.status.pending, cls: "bg-amber-50 text-amber-700 border-amber-200" };
  }
}

const categoryLabel = (t: Dict, c: string): string =>
  t.expenses.categories[c as keyof Dict["expenses"]["categories"]] ?? c;

async function resolveChefId(): Promise<string> {
  const session = await requireAuth("/chef/declaraties");
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.userId, session.user.id) });
  if (!chef) notFound();
  return chef.id;
}

async function submitVacation(formData: FormData) {
  "use server";
  const session = await requireAuth();
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.userId, session.user.id) });
  if (!chef) return;
  const euro = parseFloat(String(formData.get("amountEuro") ?? "").replace(",", "."));
  const res = await createVacationRequest({
    chefId: chef.id,
    requestedBy: session.user.id,
    kind: "payout",
    amountCents: Number.isFinite(euro) ? Math.round(euro * 100) : 0,
    note: String(formData.get("note") ?? ""),
  });
  redirect(`/chef/declaraties?ok=${res.ok ? "vacation" : "error"}`);
}

async function submitExpense(formData: FormData) {
  "use server";
  const session = await requireAuth();
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.userId, session.user.id) });
  if (!chef) return;
  const euro = parseFloat(String(formData.get("amountEuro") ?? "").replace(",", "."));
  const cat = String(formData.get("category") ?? "overig");
  const allowed = ["reiskosten", "parkeren", "ov", "kilometers", "overig"];
  // Receipt is uploaded client-side first; only accept a key under THIS chef's
  // own R2 prefix (defence-in-depth — never trust an arbitrary client key).
  const rawKey = String(formData.get("receiptR2Key") ?? "").trim();
  const receiptR2Key = rawKey.startsWith(`chefs/${chef.id}/expenses/`) ? rawKey : null;
  const res = await createExpenseClaim({
    chefId: chef.id,
    requestedBy: session.user.id,
    category: (allowed.includes(cat) ? cat : "overig") as ExpenseCategory,
    amountCents: Number.isFinite(euro) ? Math.round(euro * 100) : 0,
    description: String(formData.get("description") ?? ""),
    receiptR2Key,
  });
  redirect(`/chef/declaraties?ok=${res.ok ? "expense" : "error"}`);
}

/** CHEF-PR9b: presigned PUT for an expense receipt (browser uploads direct to R2). */
async function requestReceiptUpload(args: {
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
  const receiptId = crypto.randomUUID();
  const r2Key = chefExpenseReceiptKey(chef.id, receiptId, args.filename);
  const { url } = await getUploadUrl(r2Key, args.mimeType);
  // documentId carries the r2Key back so the form can submit it with the claim.
  return { ok: true, uploadUrl: url, documentId: r2Key };
}

type ExpenseCategory = "reiskosten" | "parkeren" | "ov" | "kilometers" | "overig";

export default async function ChefDeclaratiesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const sp = await searchParams;
  const { dict: t } = await getI18n();
  const chefId = await resolveChefId();
  const [estimate, vacReqs, expClaims] = await Promise.all([
    getChefVacationEstimate(chefId),
    listChefVacationRequests(chefId),
    listChefExpenseClaims(chefId),
  ]);

  const inputCls =
    "mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-burgundy focus:outline-none";
  const btnCls =
    "rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy/90";

  return (
    <div className="pb-24">
      <p className={LABEL}>{t.expenses.eyebrow}</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">{t.expenses.title}</h1>
      <p className="mt-3 max-w-prose text-sm text-ink-700">{t.expenses.intro}</p>

      {sp.ok === "vacation" ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {t.expenses.okVacation}
        </p>
      ) : sp.ok === "expense" ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {t.expenses.okExpense}
        </p>
      ) : sp.ok === "error" ? (
        <p className="mt-4 rounded-lg border border-burgundy/20 bg-burgundy/10 p-3 text-sm text-burgundy">
          {t.common.amountError}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {/* Vacation payout */}
        <section className="rounded-lg border border-ink-200 bg-white p-5">
          <p className={LABEL}>{t.expenses.vacationPayout}</p>
          <p className="mt-2 text-sm text-ink-700">
            {t.expenses.vacationEstimateA}
            <strong>{formatEuro(estimate.accruedCents)}</strong>
            {fill(t.expenses.vacationEstimateB, { pct: estimate.pct })}
          </p>
          <form action={submitVacation} className="mt-4 space-y-3">
            <label className="block">
              <span className="text-sm text-ink-800">{t.expenses.amountField}</span>
              <input
                name="amountEuro"
                type="text"
                inputMode="decimal"
                required
                placeholder="bijv. 150,00"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="text-sm text-ink-800">{t.common.noteOptional}</span>
              <textarea name="note" rows={2} maxLength={1000} className={inputCls} />
            </label>
            <button className={btnCls}>{t.expenses.submitRequest}</button>
          </form>
        </section>

        {/* Expense claim */}
        <section className="rounded-lg border border-ink-200 bg-white p-5">
          <p className={LABEL}>{t.expenses.declareCosts}</p>
          <p className="mt-2 text-sm text-ink-700">{t.expenses.declareIntro}</p>
          <form action={submitExpense} className="mt-4 space-y-3">
            <label className="block">
              <span className="text-sm text-ink-800">{t.expenses.kindField}</span>
              <select name="category" className={inputCls} defaultValue="reiskosten">
                {Object.keys(t.expenses.categories).map((v) => (
                  <option key={v} value={v}>
                    {categoryLabel(t, v)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-ink-800">{t.expenses.amountField}</span>
              <input
                name="amountEuro"
                type="text"
                inputMode="decimal"
                required
                placeholder="bijv. 12,50"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="text-sm text-ink-800">{t.expenses.descriptionOptional}</span>
              <textarea name="description" rows={2} maxLength={1000} className={inputCls} />
            </label>
            <ReceiptUploadField requestUpload={requestReceiptUpload} />
            <button className={btnCls}>{t.expenses.submitClaim}</button>
          </form>
        </section>
      </div>

      {/* Own requests */}
      {vacReqs.length > 0 || expClaims.length > 0 ? (
        <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
          <p className={LABEL}>{t.expenses.yourRequests}</p>
          <ul className="mt-3 divide-y divide-ink-100">
            {vacReqs.map((r) => {
              const chip = statusChip(r.status, t);
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 text-ink-700">
                    {t.expenses.vacationItem}{" "}
                    <span className="text-ink-400">
                      · {r.amountCents != null ? formatEuro(r.amountCents) : "—"}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${chip.cls}`}>
                    {chip.label}
                  </span>
                </li>
              );
            })}
            {expClaims.map((c) => {
              const chip = statusChip(c.status, t);
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-ink-700">
                    {categoryLabel(t, c.category)}{" "}
                    <span className="text-ink-400">· {formatEuro(c.amountCents)}</span>
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
