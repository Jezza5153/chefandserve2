/**
 * /admin/business/payroll — payroll batch builder (PR-CHEF-7).
 *
 * V1: CSV-first. Owner can:
 *   - View admin_approved-not-yet-exported hours in a period
 *   - Create a new payroll_batch (status=draft) grouping those rows
 *   - Download the CSV
 *   - Mark batch as exported (flips shift_hours.status → 'exported')
 *
 * Future: Payingit live API plugs into the same outbox event
 * 'payroll_batch.exported'.
 */

import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db/client";
import {
  auditLog,
  payrollBatches,
  payrollBatchLines,
  shiftHours,
  shifts,
} from "@/lib/db/schema";
import { enqueueIntegrationEvent } from "@/lib/integrations";
import {
  computeChefAmountCents,
  formatEuro,
} from "@/lib/hours-labels";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Payroll", robots: { index: false } };
export const dynamic = "force-dynamic";

/* -------- server action: create batch -------- */

async function createBatch(formData: FormData) {
  "use server";
  const session = await requireRole("owner");
  const start = String(formData.get("periodStart") ?? "");
  const end = String(formData.get("periodEnd") ?? "");
  if (!start || !end) redirect("/admin/business/payroll?error=missing-dates");

  const startDate = new Date(start);
  const endDate = new Date(end + "T23:59:59Z");

  // Find admin_approved rows in the period that aren't in any batch yet
  const candidates = await db
    .select({ h: shiftHours, s: shifts })
    .from(shiftHours)
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .where(
      and(
        eq(shiftHours.status, "admin_approved"),
        isNull(shiftHours.payingitExportedAt),
        gte(shifts.startsAt, startDate),
        lte(shifts.startsAt, endDate),
      ),
    );

  if (candidates.length === 0) {
    redirect("/admin/business/payroll?error=no-rows");
  }

  // Compute totals
  let chefCost = 0;
  let clientRev = 0;
  for (const r of candidates) {
    chefCost += computeChefAmountCents(r.h.workedMinutes, r.h.chefRateCents);
    clientRev += computeChefAmountCents(r.h.workedMinutes, r.h.clientRateCents);
  }

  const [batch] = await db
    .insert(payrollBatches)
    .values({
      periodStart: startDate,
      periodEnd: endDate,
      provider: "csv",
      status: "draft",
      rowCount: candidates.length,
      totalChefCostCents: chefCost,
      totalClientRevenueCents: clientRev,
      totalMarginCents: clientRev - chefCost,
    })
    .returning({ id: payrollBatches.id });

  await db.insert(payrollBatchLines).values(
    candidates.map((r) => ({
      batchId: batch.id,
      shiftHoursId: r.h.id,
      amountCents: computeChefAmountCents(r.h.workedMinutes, r.h.chefRateCents),
      clientAmountCents: computeChefAmountCents(r.h.workedMinutes, r.h.clientRateCents),
    })),
  );

  await db.insert(auditLog).values({
    userId: session.user.id,
    action: "payroll_batches.created",
    resource: "payroll_batches",
    resourceId: batch.id,
    after: { rowCount: candidates.length, totalChefCostCents: chefCost },
  });

  redirect(`/admin/business/payroll?ok=created&id=${batch.id}`);
}

/* -------- server action: mark exported -------- */

async function markExported(formData: FormData) {
  "use server";
  const session = await requireRole("owner");
  const batchId = String(formData.get("batchId") ?? "");
  if (!batchId) return;

  // Update batch
  const updated = await db
    .update(payrollBatches)
    .set({ status: "exported", exportedAt: new Date(), exportedBy: session.user.id })
    .where(and(eq(payrollBatches.id, batchId), eq(payrollBatches.status, "draft")))
    .returning({ id: payrollBatches.id });

  if (updated.length === 0) {
    redirect(`/admin/business/payroll?error=stale&id=${batchId}`);
  }

  // Flip every shift_hours row in the batch to 'exported'
  const lines = await db
    .select({ shiftHoursId: payrollBatchLines.shiftHoursId })
    .from(payrollBatchLines)
    .where(eq(payrollBatchLines.batchId, batchId));

  for (const l of lines) {
    await db
      .update(shiftHours)
      .set({
        status: "exported",
        payingitExportedAt: new Date(),
        payingitExportRef: batchId,
      })
      .where(and(eq(shiftHours.id, l.shiftHoursId), eq(shiftHours.status, "admin_approved")));
  }

  await db.insert(auditLog).values({
    userId: session.user.id,
    action: "payroll_batches.exported",
    resource: "payroll_batches",
    resourceId: batchId,
  });

  await enqueueIntegrationEvent({
    provider: "payroll",
    eventType: "payroll_batch.exported",
    entityType: "payroll_batch",
    entityId: batchId,
    payload: { rowCount: lines.length },
    idempotencyKey: `payroll_batch.exported:${batchId}`,
  });

  revalidatePath("/admin/business/payroll");
  redirect(`/admin/business/payroll?ok=exported&id=${batchId}`);
}

/* -------- page -------- */

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; id?: string }>;
}) {
  await requireRole("owner");
  const sp = await searchParams;

  // Period default: last calendar month
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    .toISOString()
    .slice(0, 10);
  const defaultEnd = new Date(now.getFullYear(), now.getMonth(), 0)
    .toISOString()
    .slice(0, 10);

  // Eligible rows preview (current default range)
  const candidates = await db
    .select({ count: shiftHours.id })
    .from(shiftHours)
    .where(
      and(
        eq(shiftHours.status, "admin_approved"),
        isNull(shiftHours.payingitExportedAt),
      ),
    );

  // Existing batches
  const batches = await db
    .select()
    .from(payrollBatches)
    .orderBy(desc(payrollBatches.createdAt))
    .limit(50);

  const flashOk =
    sp.ok === "created"
      ? "✓ Batch klaargezet. Download de CSV en markeer als geëxporteerd zodra het in Payingit staat."
      : sp.ok === "exported"
        ? "✓ Batch gemarkeerd als geëxporteerd. Onderliggende uren staan nu op 'exported'."
        : null;
  const flashErr =
    sp.error === "no-rows"
      ? "Geen goedgekeurde uren gevonden in die periode."
      : sp.error === "missing-dates"
        ? "Vul beide datums in."
        : sp.error === "stale"
          ? "Batch is in de tussentijd al veranderd."
          : null;

  return (
    <div className="mx-auto max-w-5xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Operations
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        Payroll
      </h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700">
        Goedgekeurde uren klaarzetten voor uitbetaling. V1 = CSV-export.
        Phase 5 voegt Payingit-live integratie toe via dezelfde batches.
      </p>

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

      {/* Create batch form */}
      <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
        <h2 className="font-serif text-xl text-ink-900">Nieuwe batch</h2>
        <p className="mt-1 text-sm text-ink-500">
          Beschikbaar (admin-goedgekeurd, niet eerder geëxporteerd):{" "}
          <strong>{candidates.length}</strong>
        </p>
        <form action={createBatch} className="mt-4 flex flex-wrap items-end gap-3">
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
            Maak batch
          </button>
        </form>
      </section>

      {/* Existing batches */}
      <section className="mt-10">
        <h2 className="font-serif text-xl text-ink-900">Eerdere batches</h2>
        {batches.length === 0 ? (
          <p className="mt-3 rounded-lg border border-ink-200 bg-white p-6 text-center text-sm text-ink-500">
            Nog geen batches aangemaakt.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {batches.map((b) => (
              <li
                key={b.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-ink-200 bg-white p-4"
              >
                <div className="min-w-0">
                  <p className="font-serif text-base text-ink-900">
                    Batch · {formatDate(b.periodStart)} – {formatDate(b.periodEnd)}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">
                    {b.rowCount ?? 0} regels · Chef {formatEuro(b.totalChefCostCents ?? 0)}{" "}
                    · Klant {formatEuro(b.totalClientRevenueCents ?? 0)} · Marge{" "}
                    {formatEuro(b.totalMarginCents ?? 0)}
                  </p>
                  {b.exportedAt ? (
                    <p className="mt-0.5 text-xs text-emerald-700">
                      ✓ Geëxporteerd op {formatDate(b.exportedAt)}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/business/payroll/${b.id}/export.csv`}
                    className="rounded-full border border-burgundy/40 bg-white px-3 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5"
                  >
                    ⬇ CSV
                  </Link>
                  <BatchStatusBadge status={b.status} />
                  {b.status === "draft" ? (
                    <form action={markExported}>
                      <input type="hidden" name="batchId" value={b.id} />
                      <button
                        type="submit"
                        className="rounded-full bg-emerald-600 px-3 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-emerald-700"
                      >
                        Markeer geëxporteerd
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BatchStatusBadge({ status }: { status: string }) {
  const tone =
    status === "exported"
      ? "bg-emerald-100 text-emerald-700"
      : status === "draft"
        ? "bg-amber-100 text-amber-800"
        : status === "void"
          ? "bg-bg-gray text-ink-500"
          : "bg-burgundy/10 text-burgundy";
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`}
    >
      {status}
    </span>
  );
}

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
