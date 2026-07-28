"use server";

/**
 * Invoice server actions — the write surface for /admin/business/invoices.
 * Every action gates on requirePermission("invoices", "read") (the owner-class
 * gate, same as payroll) + assertImpersonationAllowed() (a "Bekijk als" session
 * may not issue or settle invoices), and resolves the actor from the session.
 * All money/idempotency/atomicity logic lives in @/lib/domain/invoicing.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { env } from "@/lib/env";
import { assertImpersonationAllowed } from "@/lib/domain/impersonation";
import {
  generateInvoiceForPeriod,
  markInvoicePaid,
  sendInvoice,
  voidInvoice,
} from "@/lib/domain/invoicing";
import { requirePermission } from "@/lib/permissions";
import { addInvoiceLine, deleteInvoiceLine, type InvoiceLineKind } from "@/lib/domain/invoice-lines";

const LIST = "/admin/business/invoices";

/** Generate (or find the existing) invoice for a klant over a period. */
export async function generateInvoiceAction(formData: FormData): Promise<void> {
  const session = await requirePermission("invoices", "read");
  await assertImpersonationAllowed();
  const clientId = String(formData.get("clientId") ?? "");
  const periodStart = String(formData.get("periodStart") ?? "");
  const periodEnd = String(formData.get("periodEnd") ?? "");
  if (!clientId || !periodStart || !periodEnd) {
    redirect(`${LIST}?error=missing-fields`);
  }

  const res = await generateInvoiceForPeriod({
    clientId,
    periodStart: new Date(periodStart),
    periodEnd: new Date(periodEnd),
    actorUserId: session.user.id,
  });

  revalidatePath(LIST);
  if (!res.ok) redirect(`${LIST}?error=${encodeURIComponent(res.error)}`);
  if (res.status === "empty") redirect(`${LIST}?error=empty`);
  // created | exists → straight to the invoice.
  redirect(`${LIST}/${res.invoiceId}?ok=${res.status === "created" ? "created" : "exists"}`);
}

/** Email the invoice to the klant + flip draft→sent. */
export async function sendInvoiceAction(formData: FormData): Promise<void> {
  const session = await requirePermission("invoices", "read");
  await assertImpersonationAllowed();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!invoiceId) redirect(LIST);

  const res = await sendInvoice({
    invoiceId,
    actorUserId: session.user.id,
    portalBaseUrl: env.NEXT_PUBLIC_APP_URL,
  });

  revalidatePath(`${LIST}/${invoiceId}`);
  redirect(
    res.ok
      ? `${LIST}/${invoiceId}?ok=sent`
      : `${LIST}/${invoiceId}?error=${encodeURIComponent(res.error)}`,
  );
}

/** Mark a sent invoice as paid. */
export async function markPaidAction(formData: FormData): Promise<void> {
  const session = await requirePermission("invoices", "read");
  await assertImpersonationAllowed();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!invoiceId) redirect(LIST);

  const res = await markInvoicePaid({ invoiceId, actorUserId: session.user.id });

  revalidatePath(`${LIST}/${invoiceId}`);
  redirect(
    res.ok
      ? `${LIST}/${invoiceId}?ok=paid`
      : `${LIST}/${invoiceId}?error=${encodeURIComponent(res.error)}`,
  );
}

/** Void a draft/sent invoice (frees its hours to re-bill). */
export async function voidInvoiceAction(formData: FormData): Promise<void> {
  const session = await requirePermission("invoices", "read");
  await assertImpersonationAllowed();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!invoiceId) redirect(LIST);

  const res = await voidInvoice({
    invoiceId,
    actorUserId: session.user.id,
    ...(reason ? { reason } : {}),
  });

  revalidatePath(`${LIST}/${invoiceId}`);
  redirect(
    res.ok
      ? `${LIST}/${invoiceId}?ok=voided`
      : `${LIST}/${invoiceId}?error=${encodeURIComponent(res.error)}`,
  );
}

/**
 * Add a free line to a DRAFT invoice — a no-show fee, travel costs, materials, a fixed
 * fee or a discount. Everything that is not a worked hour used to leave the system here,
 * which is why revenue and margin were structurally incomplete rather than merely small.
 */
export async function addLineAction(formData: FormData): Promise<void> {
  const session = await requirePermission("invoices", "write");
  await assertImpersonationAllowed();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!invoiceId) redirect(LIST);

  const kind = String(formData.get("kind") ?? "fee") as InvoiceLineKind;
  const description = String(formData.get("description") ?? "");
  const amountEur = Number(String(formData.get("amountEur") ?? "").replace(",", "."));
  const vatRateBps = Number(formData.get("vatRateBps") ?? 2100);

  if (!Number.isFinite(amountEur)) {
    redirect(`${LIST}/${invoiceId}?error=${encodeURIComponent("Vul een geldig bedrag in.")}`);
  }

  const res = await addInvoiceLine({
    invoiceId,
    kind,
    description,
    amountCents: Math.round(amountEur * 100),
    vatRateBps,
    userId: session.user.id,
  });

  revalidatePath(`${LIST}/${invoiceId}`);
  redirect(
    res.ok
      ? `${LIST}/${invoiceId}?ok=line-added`
      : `${LIST}/${invoiceId}?error=${encodeURIComponent(res.error)}`,
  );
}

/** Remove a hand-added line from a DRAFT invoice. Hours lines are refused by the domain. */
export async function removeLineAction(formData: FormData): Promise<void> {
  const session = await requirePermission("invoices", "write");
  await assertImpersonationAllowed();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  if (!invoiceId || !lineId) redirect(LIST);

  const res = await deleteInvoiceLine({ lineId, userId: session.user.id });

  revalidatePath(`${LIST}/${invoiceId}`);
  redirect(
    res.ok
      ? `${LIST}/${invoiceId}?ok=line-removed`
      : `${LIST}/${invoiceId}?error=${encodeURIComponent(res.error)}`,
  );
}
