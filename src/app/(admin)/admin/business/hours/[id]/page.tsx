/**
 * /admin/business/hours/[id] — admin detail page for one shift_hours row.
 *
 * PR-CHEF-1. Minimal end-to-end: shows trust timeline + margin + approve/
 * reject buttons. The bulk-approve queue + dispute UX is PR-CHEF-3.
 *
 * Server actions:
 *   approve(id) — atomic UPDATE … WHERE status='client_signed' → 'admin_approved'
 *   reject(id, adminNotes) — atomic UPDATE … WHERE status='client_signed' → 'admin_rejected'
 *
 * Both fan out: outbox event, notification, emails.
 * Approve also enqueues 'hours.approved' for the future payroll worker.
 */

import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { HumanStatusBadge } from "@/components/hours/HumanStatusBadge";
import { TrustTimeline } from "@/components/hours/TrustTimeline";
import { AdminRejectForm } from "./AdminRejectForm";
import { db } from "@/lib/db/client";
import { recordAuditCore, stampFromRequest } from "@/lib/audit";
import { withTx } from "@/lib/db/tx";
import { recipientsForClient } from "@/lib/domain/client-recipients";
import {
  chefs,
  clients,
  shiftHours,
  shifts,
} from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import {
  createNotification,
  enqueueIntegrationEvent,
  recordEmailMessage,
} from "@/lib/integrations";
import {
  computeChefAmountCents,
  formatEuro,
  formatWorkedMinutes,
  humanStatus,
  timelineDots,
} from "@/lib/hours-labels";
import { requirePermission } from "@/lib/permissions";

import { HoursApprovedChefEmail } from "@/emails/HoursApprovedChefEmail";
import { HoursApprovedKlantEmail } from "@/emails/HoursApprovedKlantEmail";
import { HoursRejectedByAdminEmail } from "@/emails/HoursRejectedByAdminEmail";

export const metadata = { title: "Uren keuren", robots: { index: false } };
export const dynamic = "force-dynamic";

/* -------- helpers ------------------------------------------------------ */

async function loadFull(id: string) {
  const [row] = await db
    .select({
      h: shiftHours,
      chefName: chefs.fullName,
      chefEmail: chefs.email,
      chefUserId: chefs.userId,
      clientName: clients.companyName,
      clientEmail: clients.email,
      clientUserId: clients.userId,
      clientId: clients.id,
      shiftStart: shifts.startsAt,
      shiftEnd: shifts.endsAt,
      shiftRole: shifts.roleNeeded,
      shiftLocation: shifts.location,
    })
    .from(shiftHours)
    .innerJoin(chefs, eq(chefs.id, shiftHours.chefId))
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .where(eq(shiftHours.id, id))
    .limit(1);
  return row;
}

function shiftDateLabel(d: Date | string): string {
  return new Date(d).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/* -------- server actions ----------------------------------------------- */

async function approve(formData: FormData) {
  "use server";
  const session = await requirePermission("hours", "approve");
  const id = String(formData.get("hoursId") ?? "");
  if (!id) return;

  const auditBase = await stampFromRequest({
    userId: session.user.id,
    action: "shift_hours.admin_approved",
    resource: "shift_hours",
    resourceId: id,
  });
  // Atomic: status transition + audit. Redirects + side effects stay OUTSIDE
  // the callback (a redirect() throws and would roll the tx back).
  const updated = await withTx(async (tx) => {
    const u = await tx
      .update(shiftHours)
      .set({
        status: "admin_approved",
        adminApprovedAt: new Date(),
        adminApprovedBy: session.user.id,
        updatedAt: new Date(),
      })
      .where(
        and(eq(shiftHours.id, id), eq(shiftHours.status, "client_signed")),
      )
      .returning({
        id: shiftHours.id,
        chefId: shiftHours.chefId,
        clientId: shiftHours.clientId,
        workedMinutes: shiftHours.workedMinutes,
        chefRateCents: shiftHours.chefRateCents,
        clientRateCents: shiftHours.clientRateCents,
      });
    if (u.length === 0) return u;
    await recordAuditCore(auditBase, tx);
    return u;
  });

  if (updated.length === 0) {
    redirect(`/admin/business/hours/${id}?error=stale`);
  }

  await enqueueIntegrationEvent({
    provider: "payroll",
    eventType: "hours.approved",
    entityType: "shift_hours",
    entityId: id,
    payload: {
      workedMinutes: updated[0].workedMinutes,
      chefRateCents: updated[0].chefRateCents,
      clientRateCents: updated[0].clientRateCents,
    },
    idempotencyKey: `hours.approved:${id}`,
  });

  const ctx = await loadFull(id);
  if (ctx?.chefUserId) {
    await createNotification({
      userId: ctx.chefUserId,
      type: "hours_approved",
      title: "Je uren zijn goedgekeurd",
      body: "Wordt uitbetaald via payroll.",
      actionUrl: "/chef/hours",
      entityType: "shift_hours",
      entityId: id,
    });
  }
  if (ctx?.chefEmail && ctx?.shiftStart) {
    const send = await sendEmail({
      to: ctx.chefEmail,
      subject: "Uren goedgekeurd — wordt uitbetaald",
      react: HoursApprovedChefEmail({
        recipientName: ctx.chefName,
        clientName: ctx.clientName,
        shiftDate: shiftDateLabel(ctx.shiftStart),
        workedHoursLabel: formatWorkedMinutes(ctx.h.workedMinutes),
        expectedAmountEur:
          computeChefAmountCents(ctx.h.workedMinutes, ctx.h.chefRateCents) / 100,
      }),
    });
    if (send.ok) {
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: ctx.chefEmail,
        template: "HoursApprovedChefEmail",
        eventKey: "hours_approved",
        entityType: "shift_hours",
        entityId: id,
        userId: ctx.chefUserId ?? undefined,
      });
    }
  }
  // PR-AUDIT-2: route via recipientsForClient (single seam + billing/contact
  // routing). Operational invoice notice → "generic" (always sends).
  const klantApprovedTo =
    ctx?.shiftStart && ctx.clientId
      ? await recipientsForClient(ctx.clientId, "generic")
      : [];
  if (klantApprovedTo.length > 0 && ctx?.shiftStart) {
    const send = await sendEmail({
      to: klantApprovedTo,
      subject: `Uren afgerond voor ${shiftDateLabel(ctx.shiftStart)} — factuur volgt`,
      react: HoursApprovedKlantEmail({
        recipientName: ctx.clientName,
        chefName: ctx.chefName,
        shiftDate: shiftDateLabel(ctx.shiftStart),
        workedHoursLabel: formatWorkedMinutes(ctx.h.workedMinutes),
        clientAmountEur:
          computeChefAmountCents(ctx.h.workedMinutes, ctx.h.clientRateCents) / 100,
      }),
    });
    if (send.ok) {
      for (const to of klantApprovedTo) {
        await recordEmailMessage({
          providerMessageId: send.id,
          toEmail: to,
          template: "HoursApprovedKlantEmail",
          eventKey: "hours_approved",
          entityType: "shift_hours",
          entityId: id,
          userId: ctx.clientUserId ?? undefined,
        });
      }
    }
  }

  redirect("/admin/business/hours?ok=approved");
}

async function reject(formData: FormData) {
  "use server";
  const session = await requirePermission("hours", "approve");
  const id = String(formData.get("hoursId") ?? "");
  const adminNotes = String(formData.get("adminNotes") ?? "").trim();
  if (!id) return;
  if (adminNotes.length < 5) {
    redirect(`/admin/business/hours/${id}?error=reason-required`);
  }

  // Reject → row goes back to 'draft' so chef can re-submit. We use a
  // distinct status 'admin_rejected' so the chef UI shows the warning.
  const auditBase = await stampFromRequest({
    userId: session.user.id,
    action: "shift_hours.admin_rejected",
    resource: "shift_hours",
    resourceId: id,
    after: { adminNotes },
  });
  const updated = await withTx(async (tx) => {
    const u = await tx
      .update(shiftHours)
      .set({
        status: "admin_rejected",
        adminRejectedAt: new Date(),
        adminNotes,
        updatedAt: new Date(),
      })
      .where(
        and(eq(shiftHours.id, id), eq(shiftHours.status, "client_signed")),
      )
      .returning({ id: shiftHours.id });
    if (u.length === 0) return u;
    await recordAuditCore(auditBase, tx);
    return u;
  });

  if (updated.length === 0) {
    redirect(`/admin/business/hours/${id}?error=stale`);
  }

  const ctx = await loadFull(id);
  if (!ctx) redirect("/admin/business/hours");

  // Notify both chef + klant
  if (ctx.chefUserId) {
    await createNotification({
      userId: ctx.chefUserId,
      type: "hours_rejected_by_admin",
      title: "Chef & Serve heeft je uren teruggezet",
      body: adminNotes,
      actionUrl: "/chef/hours",
      entityType: "shift_hours",
      entityId: id,
    });
  }
  if (ctx.clientUserId) {
    await createNotification({
      userId: ctx.clientUserId,
      type: "hours_rejected_by_admin",
      title: `Chef & Serve heeft uren van ${ctx.chefName} teruggezet`,
      body: "Wij coördineren met de chef — je hoeft niets te doen.",
      entityType: "shift_hours",
      entityId: id,
    });
  }

  const placement = await db.query.shiftHours.findFirst({
    where: eq(shiftHours.id, id),
  });
  const editUrl = placement?.placementId
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/chef/hours/${placement.placementId}`
    : undefined;

  if (ctx.chefEmail && ctx.shiftStart) {
    const send = await sendEmail({
      to: ctx.chefEmail,
      subject: "Chef & Serve heeft je uren teruggezet",
      react: HoursRejectedByAdminEmail({
        recipientName: ctx.chefName,
        recipientRole: "chef",
        chefName: ctx.chefName,
        clientName: ctx.clientName,
        shiftDate: shiftDateLabel(ctx.shiftStart),
        adminNote: adminNotes,
        editUrl,
      }),
    });
    if (send.ok) {
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: ctx.chefEmail,
        template: "HoursRejectedByAdminEmail",
        eventKey: "hours_admin_rejected",
        entityType: "shift_hours",
        entityId: id,
        userId: ctx.chefUserId ?? undefined,
      });
    }
  }
  // PR-AUDIT-2: route via recipientsForClient. Operational correction notice
  // → "generic" (always sends; not opt-out-able).
  const klantRejectedTo =
    ctx.shiftStart && ctx.clientId
      ? await recipientsForClient(ctx.clientId, "generic")
      : [];
  if (klantRejectedTo.length > 0 && ctx.shiftStart) {
    const send = await sendEmail({
      to: klantRejectedTo,
      subject: `Uren-correctie voor ${ctx.chefName} op ${shiftDateLabel(ctx.shiftStart)}`,
      react: HoursRejectedByAdminEmail({
        recipientName: ctx.clientName,
        recipientRole: "klant",
        chefName: ctx.chefName,
        clientName: ctx.clientName,
        shiftDate: shiftDateLabel(ctx.shiftStart),
        adminNote: adminNotes,
      }),
    });
    if (send.ok) {
      for (const to of klantRejectedTo) {
        await recordEmailMessage({
          providerMessageId: send.id,
          toEmail: to,
          template: "HoursRejectedByAdminEmail",
          eventKey: "hours_admin_rejected",
          entityType: "shift_hours",
          entityId: id,
          userId: ctx.clientUserId ?? undefined,
        });
      }
    }
  }

  redirect("/admin/business/hours?ok=rejected");
}

/* -------- page --------------------------------------------------------- */

export default async function AdminHoursDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission("hours", "approve");
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await loadFull(id);
  if (!ctx) notFound();

  const chefCost = computeChefAmountCents(
    ctx.h.workedMinutes,
    ctx.h.chefRateCents,
  );
  const clientRev = computeChefAmountCents(
    ctx.h.workedMinutes,
    ctx.h.clientRateCents,
  );
  const margin = clientRev - chefCost;
  const canApprove = ctx.h.status === "client_signed";

  const errorMsg =
    sp.error === "reason-required"
      ? "Geef een reden (minimaal 5 tekens) waarom je terugzet."
      : sp.error === "stale"
        ? "Status is in de tussentijd veranderd."
        : null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <Link
          href="/admin/business/hours"
          className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          ← Uren keuren
        </Link>
      </div>

      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Uren keuren
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        {ctx.chefName} · {ctx.clientName}
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        {shiftDateLabel(ctx.shiftStart)} · {ctx.shiftRole}
        {ctx.shiftLocation ? ` · ${ctx.shiftLocation}` : null}
      </p>

      <div className="mt-4 flex items-center gap-2">
        <HumanStatusBadge status={ctx.h.status} />
        <span className="text-sm text-ink-700">{humanStatus(ctx.h.status)}</span>
      </div>

      {/* Receipt */}
      <div className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
        <h2 className="font-serif text-lg text-ink-900">Ingevulde uren</h2>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <Row label="Gepland" value={`${formatTime(ctx.shiftStart)} – ${formatTime(ctx.shiftEnd)}`} />
          <Row label="Ingevuld" value={`${formatTime(ctx.h.startedAt)} – ${formatTime(ctx.h.endedAt)}`} />
          <Row label="Pauze" value={`${ctx.h.breakMinutes} min`} />
          <Row label="Totaal" value={formatWorkedMinutes(ctx.h.workedMinutes)} />
        </dl>
        {ctx.h.chefNotes ? (
          <p className="mt-3 rounded border border-ink-200 bg-bg-gray px-3 py-2 text-xs italic text-ink-700">
            Chef-notitie: {ctx.h.chefNotes}
          </p>
        ) : null}
        {ctx.h.clientNotes ? (
          <p className="mt-3 rounded border border-ink-200 bg-bg-gray px-3 py-2 text-xs italic text-ink-700">
            Klant-notitie: {ctx.h.clientNotes}
          </p>
        ) : null}
      </div>

      {/* Money */}
      <div className="mt-6 rounded-lg border border-ink-200 bg-white p-6">
        <h2 className="font-serif text-lg text-ink-900">Bedragen</h2>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
          <Row label="Chef kost" value={formatEuro(chefCost)} />
          <Row label="Klant omzet" value={formatEuro(clientRev)} />
          <Row label="Marge" value={formatEuro(margin)} bold />
        </dl>
      </div>

      {/* Timeline */}
      <div className="mt-6">
        <TrustTimeline steps={timelineDots(ctx.h)} />
      </div>

      {/* Action */}
      {canApprove ? (
        <section className="mt-8 space-y-4">
          {errorMsg ? (
            <p className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
              {errorMsg}
            </p>
          ) : null}

          <form action={approve} className="inline">
            <input type="hidden" name="hoursId" value={id} />
            <button
              type="submit"
              className="rounded-full bg-emerald-600 px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-emerald-700"
            >
              ✓ Goedkeuren
            </button>
          </form>

          <AdminRejectForm hoursId={id} rejectAction={reject} />
        </section>
      ) : (
        <section className="mt-8 rounded-lg border border-ink-200 bg-white p-4 text-sm text-ink-700">
          Geen actie nodig — status: <strong>{humanStatus(ctx.h.status)}</strong>.
        </section>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
        {label}
      </p>
      <p className={bold ? "mt-1 font-mono text-base text-ink-900" : "mt-1 font-mono text-sm text-ink-900"}>
        {value}
      </p>
    </div>
  );
}

function formatTime(d: Date | string): string {
  return new Date(d).toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
