/**
 * GET /admin/business/payroll/[id]/export.csv — PR-CHEF-7.
 *
 * Streams the CSV for a payroll_batch. Admin only.
 *
 * CSV columns:
 *   batch_id, line_id, shift_hours_id, chef_external_id, chef_name,
 *   client_external_id, client_name, shift_date, started_at, ended_at,
 *   break_minutes, worked_minutes, chef_rate_cents, chef_amount_cents,
 *   client_rate_cents, client_amount_cents
 *
 * External IDs come from external_refs (provider='payingit'). If a chef
 * doesn't have one yet, column is empty — payroll team can fill it in
 * downstream then admin can re-map via PR-CHEF-FUT api_clients.
 */

import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import {
  chefs,
  clients,
  externalRefs,
  payrollBatchLines,
  payrollBatches,
  shiftHours,
  shifts, chefExpenseClaims } from "@/lib/db/schema";
import { requirePermission } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requirePermission("payroll", "export");
  const { id } = await ctx.params;

  const [batch] = await db
    .select()
    .from(payrollBatches)
    .where(eq(payrollBatches.id, id))
    .limit(1);
  if (!batch) return new NextResponse("Not found", { status: 404 });

  const rows = await db
    .select({
      lineId: payrollBatchLines.id,
      shiftHoursId: payrollBatchLines.shiftHoursId,
      amount: payrollBatchLines.amountCents,
      clientAmount: payrollBatchLines.clientAmountCents,
      h: shiftHours,
      claimId: payrollBatchLines.expenseClaimId,
      claimCategory: chefExpenseClaims.category,
      claimDescription: chefExpenseClaims.description,
      claimChefId: chefExpenseClaims.chefId,
      claimCreatedAt: chefExpenseClaims.createdAt,
      chefId: chefs.id,
      chefName: chefs.fullName,
      clientId: clients.id,
      clientName: clients.companyName,
      shiftStart: shifts.startsAt,
    })
    .from(payrollBatchLines)
    // leftJoin, not innerJoin: a payroll line is no longer always an hours line. An
    // approved expense claim is money owed to the chef and has no shift_hours row, so an
    // inner join would drop it from the file silently — the chef would simply not be paid.
    .leftJoin(shiftHours, eq(shiftHours.id, payrollBatchLines.shiftHoursId))
    .leftJoin(chefExpenseClaims, eq(chefExpenseClaims.id, payrollBatchLines.expenseClaimId))
    .leftJoin(chefs, eq(chefs.id, sql`coalesce(${shiftHours.chefId}, ${chefExpenseClaims.chefId})`))
    .leftJoin(clients, eq(clients.id, sql`coalesce(${shiftHours.clientId}, ${chefExpenseClaims.clientId})`))
    .leftJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .where(eq(payrollBatchLines.batchId, id));

  // Resolve external refs once per chef + client
  const chefIds = [...new Set(rows.map((r) => r.chefId).filter((x): x is string => !!x))];
  const clientIds = [...new Set(rows.map((r) => r.clientId).filter((x): x is string => !!x))];
  const chefRefs = new Map<string, string>();
  const clientRefs = new Map<string, string>();
  if (chefIds.length > 0) {
    const refs = await db
      .select()
      .from(externalRefs)
      .where(
        and(eq(externalRefs.provider, "payingit"), eq(externalRefs.entityType, "chef")),
      );
    for (const r of refs) {
      if (chefIds.includes(r.entityId)) chefRefs.set(r.entityId, r.externalId);
    }
  }
  if (clientIds.length > 0) {
    const refs = await db
      .select()
      .from(externalRefs)
      .where(
        and(
          eq(externalRefs.provider, "payingit"),
          eq(externalRefs.entityType, "client"),
        ),
      );
    for (const r of refs) {
      if (clientIds.includes(r.entityId)) clientRefs.set(r.entityId, r.externalId);
    }
  }

  const lines: string[] = [];
  lines.push(
    [
      "batch_id",
      "line_id",
      "shift_hours_id",
      "chef_external_id",
      "chef_name",
      "client_external_id",
      "client_name",
      "shift_date",
      "started_at",
      "ended_at",
      "break_minutes",
      "worked_minutes",
      "chef_rate_cents",
      "chef_amount_cents",
      "client_rate_cents",
      "client_amount_cents",
      // Nieuw: onderscheidt een urenregel van een doorbelaste declaratie. Zonder deze
      // kolom zou Payingit twee wezenlijk verschillende regels als hetzelfde lezen.
      "regel_soort",
      "omschrijving",
    ]
      .map(csvCell)
      .join(","),
  );
  for (const r of rows) {
    lines.push(
      [
        batch.id,
        r.lineId,
        r.shiftHoursId ?? "",
        (r.chefId ? chefRefs.get(r.chefId) : "") ?? "",
        r.chefName ?? "",
        (r.clientId ? clientRefs.get(r.clientId) : "") ?? "",
        r.clientName ?? "",
        // Een declaratie heeft geen dienst; dan is de indiendatum de enige datum die klopt.
        (r.shiftStart ? new Date(r.shiftStart) : r.claimCreatedAt ? new Date(r.claimCreatedAt) : new Date())
          .toISOString()
          .slice(0, 10),
        r.h?.startedAt ? new Date(r.h.startedAt).toISOString() : "",
        r.h?.endedAt ? new Date(r.h.endedAt).toISOString() : "",
        r.h?.breakMinutes ?? "",
        r.h?.workedMinutes ?? "",
        r.h?.chefRateCents ?? "",
        r.amount,
        r.h?.clientRateCents ?? "",
        r.clientAmount,
        r.claimId ? "declaratie" : "uren",
        r.claimId ? `${r.claimCategory ?? "declaratie"}${r.claimDescription ? ` — ${r.claimDescription}` : ""}` : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const csv = lines.join("\n") + "\n";
  const filename = `payroll-batch-${batch.id.slice(0, 8)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
