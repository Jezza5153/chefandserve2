/**
 * GET /admin/business/invoices/export.csv — PR-INVOICE-A7 (lite).
 *
 * Invoice-level CSV for the bookkeeper / accounting platform import. One row per
 * invoice (number, klant, KVK/BTW, period, dates, ex-BTW + BTW + total, status).
 * The unblocked path toward accounting integration: a manual export the operator
 * hands to their accountant, until a live API is chosen.
 *
 * Optional `?status=paid|sent|draft|void|credit` filter. Owner-gated
 * (invoices.read). Euro amounts are dot-decimal for unambiguous import.
 */
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { requirePermission } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["draft", "sent", "paid", "void", "credit"] as const;
type InvoiceStatus = (typeof STATUSES)[number];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

const day = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const eur = (cents: number) => (cents / 100).toFixed(2);

export async function GET(req: Request) {
  await requirePermission("invoices", "read");

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const status = STATUSES.includes(statusParam as InvoiceStatus)
    ? (statusParam as InvoiceStatus)
    : null;

  const rows = await db
    .select()
    .from(invoices)
    .where(status ? eq(invoices.status, status) : undefined)
    .orderBy(desc(invoices.issueDate), desc(invoices.number));

  const header = [
    "number",
    "client_name",
    "kvk",
    "btw",
    "period_start",
    "period_end",
    "issue_date",
    "due_date",
    "subtotal_eur",
    "vat_rate_pct",
    "vat_eur",
    "total_eur",
    "status",
    "sent_at",
    "paid_at",
    "external_ref",
  ];

  const lines = [header.map(csvCell).join(",")];
  for (const inv of rows) {
    lines.push(
      [
        inv.number,
        inv.billToName,
        inv.billToKvk,
        inv.billToBtw,
        day(inv.periodStart),
        day(inv.periodEnd),
        day(inv.issueDate),
        day(inv.dueDate),
        eur(inv.subtotalCents),
        (inv.vatRateBps / 100).toString(),
        eur(inv.vatCents),
        eur(inv.totalCents),
        inv.status,
        inv.sentAt ? new Date(inv.sentAt).toISOString() : "",
        inv.paidAt ? new Date(inv.paidAt).toISOString() : "",
        inv.externalRef,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const csv = lines.join("\n") + "\n";
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `facturen-${status ?? "alle"}-${stamp}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
