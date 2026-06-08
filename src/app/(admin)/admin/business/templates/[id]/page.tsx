/**
 * /admin/business/templates/[id] — template detail (PR-KLANT-4).
 *
 * Shows the pattern, next generated dates AND exceptions side-by-side (so the
 * admin sees the gap), the exceptions manager, and an active toggle.
 * Editing the pattern itself is intentionally NOT offered here in V1 —
 * pause + recreate keeps "edits never rewrite existing shifts" simple.
 */

import { and, asc, count, eq, gte } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ExceptionsManager } from "./ExceptionsManager";
import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import {
  clients,
  shiftTemplateExceptions,
  shiftTemplates,
  shifts,
} from "@/lib/db/schema";
import {
  formatIsoDate,
  formatPattern,
  formatTimeRange,
  previewDates,
} from "@/lib/shift-template-format";
import { formatShiftRole } from "@/lib/labels";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Template" };
export const dynamic = "force-dynamic";

export default async function TemplateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  await requirePermission("templates", "write");
  const { id } = await params;
  const sp = await searchParams;

  const t = await db.query.shiftTemplates.findFirst({
    where: eq(shiftTemplates.id, id),
  });
  if (!t) notFound();
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, t.clientId),
  });

  const exceptions = await db
    .select()
    .from(shiftTemplateExceptions)
    .where(eq(shiftTemplateExceptions.templateId, id))
    .orderBy(asc(shiftTemplateExceptions.date));

  const [{ generated } = { generated: 0 }] = await db
    .select({ generated: count() })
    .from(shifts)
    .where(
      and(eq(shifts.sourceTemplateId, id), gte(shifts.startsAt, new Date())),
    );

  /* ----- server actions ----- */
  async function addException(formData: FormData) {
    "use server";
    const session = await requirePermission("templates", "write");
    const date = String(formData.get("date") ?? "");
    const reason = String(formData.get("reason") ?? "").trim() || null;
    if (!date) redirect(`/admin/business/templates/${id}`);
    await db
      .insert(shiftTemplateExceptions)
      .values({ templateId: id, date, reason, createdBy: session.user.id })
      .onConflictDoNothing();
    await recordAuditFromRequest({
      userId: session.user.id,
      action: "shift_templates.exception_added",
      resource: "shift_templates",
      resourceId: id,
      after: { date, reason },
    });
    redirect(`/admin/business/templates/${id}?ok=exception-added`);
  }

  async function removeException(formData: FormData) {
    "use server";
    const session = await requirePermission("templates", "write");
    const exceptionId = String(formData.get("exceptionId") ?? "");
    if (!exceptionId) redirect(`/admin/business/templates/${id}`);
    await db
      .delete(shiftTemplateExceptions)
      .where(eq(shiftTemplateExceptions.id, exceptionId));
    await recordAuditFromRequest({
      userId: session.user.id,
      action: "shift_templates.exception_removed",
      resource: "shift_templates",
      resourceId: id,
      after: { exceptionId },
    });
    redirect(`/admin/business/templates/${id}?ok=exception-removed`);
  }

  async function toggleActive() {
    "use server";
    const session = await requirePermission("templates", "write");
    const [cur] = await db
      .select({ active: shiftTemplates.active })
      .from(shiftTemplates)
      .where(eq(shiftTemplates.id, id))
      .limit(1);
    const next = !cur?.active;
    await db
      .update(shiftTemplates)
      .set({ active: next, updatedAt: new Date() })
      .where(eq(shiftTemplates.id, id));
    await recordAuditFromRequest({
      userId: session.user.id,
      action: next ? "shift_templates.activated" : "shift_templates.paused",
      resource: "shift_templates",
      resourceId: id,
    });
    redirect(`/admin/business/templates/${id}?ok=${next ? "activated" : "paused"}`);
  }

  const exceptionSet = new Set(exceptions.map((e) => e.date));
  const upcoming = previewDates(t.dayOfWeek, t.generateHorizonDays, exceptionSet);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/admin/business/templates"
        className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
      >
        ← Alle templates
      </Link>

      <h1 className="mt-2 font-serif text-3xl text-ink-900">
        {client?.companyName ?? "Klant"}
      </h1>
      <p className="mt-2 text-sm text-ink-700">
        {formatPattern({
          dayOfWeek: t.dayOfWeek,
          startsAtTime: t.startsAtTime,
          endsAtTime: t.endsAtTime,
          endsNextDay: t.endsNextDay,
        })}{" "}
        · {formatShiftRole(t.roleNeeded)} · {t.headcount} chef{t.headcount === 1 ? "" : "s"}
      </p>

      {sp.ok ? (
        <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          ✓ Bijgewerkt.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span
          className={`rounded-full px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-wider ${
            t.active ? "bg-emerald-100 text-emerald-700" : "bg-bg-gray text-ink-500"
          }`}
        >
          {t.active ? "Actief" : "Gepauzeerd"}
        </span>
        <span className="text-xs text-ink-500">
          {generated} komende shift{generated === 1 ? "" : "s"} aangemaakt ·
          tijd: {formatTimeRange(t.startsAtTime, t.endsAtTime, t.endsNextDay)}
        </span>
        <form action={toggleActive}>
          <button
            type="submit"
            className="rounded-full border border-ink-200 bg-white px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-700 hover:border-burgundy/40 hover:text-burgundy"
          >
            {t.active ? "Pauzeer" : "Activeer"}
          </button>
        </form>
      </div>
      {t.active ? null : (
        <p className="mt-2 text-xs text-ink-500">
          Gepauzeerd: er worden geen nieuwe shifts meer aangemaakt. Bestaande
          shifts blijven staan.
        </p>
      )}

      {/* Next dates */}
      <section className="mt-8">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Volgende shifts ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-xs text-ink-500">
            Geen datums in de horizon.
          </p>
        ) : (
          <ul className="mt-2 grid grid-cols-2 gap-1 text-sm text-ink-900 sm:grid-cols-3">
            {upcoming.slice(0, 12).map((iso) => (
              <li key={iso} className="text-xs">
                {formatIsoDate(iso)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ExceptionsManager
        exceptions={exceptions}
        addAction={addException}
        removeAction={removeException}
      />
    </div>
  );
}
