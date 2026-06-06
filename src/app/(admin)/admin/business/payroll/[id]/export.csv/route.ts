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

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import {
  chefs,
  clients,
  externalRefs,
  payrollBatchLines,
  payrollBatches,
  shiftHours,
  shifts,
} from "@/lib/db/schema";
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
      chefId: chefs.id,
      chefName: chefs.fullName,
      clientId: clients.id,
      clientName: clients.companyName,
      shiftStart: shifts.startsAt,
    })
    .from(payrollBatchLines)
    .innerJoin(shiftHours, eq(shiftHours.id, payrollBatchLines.shiftHoursId))
    .innerJoin(chefs, eq(chefs.id, shiftHours.chefId))
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .where(eq(payrollBatchLines.batchId, id));

  // Resolve external refs once per chef + client
  const chefIds = [...new Set(rows.map((r) => r.chefId))];
  const clientIds = [...new Set(rows.map((r) => r.clientId))];
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
    ]
      .map(csvCell)
      .join(","),
  );
  for (const r of rows) {
    lines.push(
      [
        batch.id,
        r.lineId,
        r.shiftHoursId,
        chefRefs.get(r.chefId) ?? "",
        r.chefName,
        clientRefs.get(r.clientId) ?? "",
        r.clientName,
        new Date(r.shiftStart).toISOString().slice(0, 10),
        new Date(r.h.startedAt).toISOString(),
        new Date(r.h.endedAt).toISOString(),
        r.h.breakMinutes,
        r.h.workedMinutes,
        r.h.chefRateCents,
        r.amount,
        r.h.clientRateCents,
        r.clientAmount,
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
