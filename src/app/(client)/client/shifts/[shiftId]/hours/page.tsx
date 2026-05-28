/**
 * /client/shifts/[shiftId]/hours — klant receipt page (PR-CHEF-1).
 *
 * UX rule (from plan): "It should feel like checking a receipt, not admin work."
 * Klant CANNOT edit times. Only Akkoord / Niet akkoord (with reason).
 * Editing by klant creates dispute chaos; admin mediates.
 *
 * Renders one card per chef on the shift. Each card:
 *   - Receipt block (chef name, scheduled vs actual, break, totaal)
 *   - TrustTimeline
 *   - Buttons (only when status='submitted'): Akkoord / Niet akkoord (textarea)
 *   - Status read-only when already signed/rejected/etc.
 *
 * Server actions:
 *   sign(hoursId)   — atomic UPDATE … WHERE status='submitted' → 'client_signed'
 *   reject(hoursId) — atomic UPDATE … WHERE status='submitted' → 'client_rejected'
 *                     with mandatory clientNotes (≥5 chars)
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { HumanStatusBadge } from "@/components/hours/HumanStatusBadge";
import { RejectForm } from "./RejectForm";
import { TrustTimeline } from "@/components/hours/TrustTimeline";
import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
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
  humanNextAction,
  timelineDots,
} from "@/lib/hours-labels";
import { recipientsFor } from "@/lib/notifications";
import { requireAuth } from "@/lib/permissions";

import { HoursRejectedByKlantChefEmail } from "@/emails/HoursRejectedByKlantChefEmail";
import { HoursSignedAdminEmail } from "@/emails/HoursSignedAdminEmail";
import { HoursSignedChefEmail } from "@/emails/HoursSignedChefEmail";

export const metadata = { title: "Uren controleren" };
export const dynamic = "force-dynamic";

/* -------- helper: resolve the klant for this session ------------------- */

async function requireClientSelf() {
  const session = await requireAuth();
  if (session.user.kind !== "client" && !session.user.roles.includes("super_admin")) {
    redirect("/");
  }
  const [c] = await db
    .select({
      id: clients.id,
      companyName: clients.companyName,
      userId: clients.userId,
    })
    .from(clients)
    .where(eq(clients.userId, session.user.id))
    .limit(1);
  if (!c) redirect("/client");
  return { client: c, session };
}

/* -------- server actions ----------------------------------------------- */

async function sign(formData: FormData) {
  "use server";
  const { client, session } = await requireClientSelf();
  const hoursId = String(formData.get("hoursId") ?? "");
  if (!hoursId) return;

  // Atomic — only flip if currently 'submitted' AND owned by this client.
  const updated = await db
    .update(shiftHours)
    .set({
      status: "client_signed",
      clientSignedAt: new Date(),
      clientSignedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(shiftHours.id, hoursId),
        eq(shiftHours.clientId, client.id),
        eq(shiftHours.status, "submitted"),
      ),
    )
    .returning({
      id: shiftHours.id,
      chefId: shiftHours.chefId,
      workedMinutes: shiftHours.workedMinutes,
      chefRateCents: shiftHours.chefRateCents,
      clientRateCents: shiftHours.clientRateCents,
      shiftId: shiftHours.shiftId,
    });

  if (updated.length === 0) {
    redirect(`/client/shifts/${formData.get("shiftId")}/hours?error=stale`);
  }
  const row = updated[0];

  await recordAuditFromRequest({
    userId: session.user.id,
    action: "shift_hours.client_signed",
    resource: "shift_hours",
    resourceId: row.id,
    after: { clientId: client.id },
  });

  await enqueueIntegrationEvent({
    provider: "internal",
    eventType: "hours.client_signed",
    entityType: "shift_hours",
    entityId: row.id,
    payload: { clientId: client.id },
    idempotencyKey: `hours.client_signed:${row.id}`,
  });

  // Fan out: chef + admin recipients
  const [chefInfo] = await db
    .select({
      chefUserId: chefs.userId,
      chefEmail: chefs.email,
      chefName: chefs.fullName,
      shiftStart: shifts.startsAt,
    })
    .from(chefs)
    .innerJoin(shifts, eq(shifts.id, row.shiftId))
    .where(eq(chefs.id, row.chefId))
    .limit(1);

  if (chefInfo?.chefUserId) {
    await createNotification({
      userId: chefInfo.chefUserId,
      type: "hours_signed",
      title: `${client.companyName} heeft je uren ondertekend`,
      body: "Chef & Serve controleert nu en zet daarna uitbetaling in gang.",
      actionUrl: `/chef/hours`,
      entityType: "shift_hours",
      entityId: row.id,
    });
  }
  if (chefInfo?.chefEmail) {
    const send = await sendEmail({
      to: chefInfo.chefEmail,
      subject: `Je uren zijn ondertekend door ${client.companyName}`,
      react: HoursSignedChefEmail({
        recipientName: chefInfo.chefName,
        clientName: client.companyName,
        shiftDate: new Date(chefInfo.shiftStart).toLocaleDateString("nl-NL", {
          weekday: "long",
          day: "numeric",
          month: "long",
        }),
        workedHoursLabel: formatWorkedMinutes(row.workedMinutes),
        expectedAmountEur:
          computeChefAmountCents(row.workedMinutes, row.chefRateCents) / 100,
      }),
    });
    if (send.ok) {
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: chefInfo.chefEmail,
        template: "HoursSignedChefEmail",
        eventKey: "hours_signed",
        entityType: "shift_hours",
        entityId: row.id,
        userId: chefInfo.chefUserId ?? undefined,
      });
    }
  }

  // Admin (routable)
  const adminRecipients = await recipientsFor("hours_signed");
  if (adminRecipients.length > 0) {
    const chefCost =
      computeChefAmountCents(row.workedMinutes, row.chefRateCents) / 100;
    const clientRev =
      computeChefAmountCents(row.workedMinutes, row.clientRateCents) / 100;
    const send = await sendEmail({
      to: adminRecipients,
      subject: `Uren goedgekeurd door ${client.companyName} — keuren?`,
      react: HoursSignedAdminEmail({
        chefName: chefInfo?.chefName ?? "—",
        clientName: client.companyName,
        shiftDate: chefInfo?.shiftStart
          ? new Date(chefInfo.shiftStart).toLocaleDateString("nl-NL", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })
          : "—",
        workedHoursLabel: formatWorkedMinutes(row.workedMinutes),
        chefAmountEur: chefCost,
        clientAmountEur: clientRev,
        marginEur: clientRev - chefCost,
        approveUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/admin/business/hours/${row.id}`,
      }),
    });
    if (send.ok) {
      // single email_messages row for the batch — same providerId for all
      // recipients per Resend semantics
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: adminRecipients[0],
        template: "HoursSignedAdminEmail",
        eventKey: "hours_signed",
        entityType: "shift_hours",
        entityId: row.id,
      });
    }
  }

  redirect(`/client/shifts/${row.shiftId}/hours?ok=signed`);
}

async function reject(formData: FormData) {
  "use server";
  const { client, session } = await requireClientSelf();
  const hoursId = String(formData.get("hoursId") ?? "");
  const reason = String(formData.get("clientNotes") ?? "").trim();
  const shiftIdFromForm = String(formData.get("shiftId") ?? "");

  if (!hoursId) return;
  if (reason.length < 5) {
    redirect(`/client/shifts/${shiftIdFromForm}/hours?error=reason-required&row=${hoursId}`);
  }

  const updated = await db
    .update(shiftHours)
    .set({
      status: "client_rejected",
      clientRejectedAt: new Date(),
      clientNotes: reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(shiftHours.id, hoursId),
        eq(shiftHours.clientId, client.id),
        eq(shiftHours.status, "submitted"),
      ),
    )
    .returning({
      id: shiftHours.id,
      chefId: shiftHours.chefId,
      shiftId: shiftHours.shiftId,
    });

  if (updated.length === 0) {
    redirect(`/client/shifts/${shiftIdFromForm}/hours?error=stale`);
  }
  const row = updated[0];

  await recordAuditFromRequest({
    userId: session.user.id,
    action: "shift_hours.client_rejected",
    resource: "shift_hours",
    resourceId: row.id,
    after: { clientId: client.id, reason },
  });

  await enqueueIntegrationEvent({
    provider: "internal",
    eventType: "hours.client_rejected",
    entityType: "shift_hours",
    entityId: row.id,
    payload: { clientId: client.id, reason },
    idempotencyKey: `hours.client_rejected:${row.id}:${Date.now()}`,
  });

  const [chefInfo] = await db
    .select({
      chefUserId: chefs.userId,
      chefEmail: chefs.email,
      chefName: chefs.fullName,
      shiftStart: shifts.startsAt,
    })
    .from(chefs)
    .innerJoin(shifts, eq(shifts.id, row.shiftId))
    .where(eq(chefs.id, row.chefId))
    .limit(1);

  if (chefInfo?.chefUserId) {
    await createNotification({
      userId: chefInfo.chefUserId,
      type: "hours_rejected_by_klant",
      title: `${client.companyName} niet akkoord met je uren`,
      body: `Reden: ${reason}`,
      actionUrl: `/chef/hours`,
      entityType: "shift_hours",
      entityId: row.id,
    });
  }

  if (chefInfo?.chefEmail) {
    const send = await sendEmail({
      to: chefInfo.chefEmail,
      subject: `Uren-correctie nodig — ${client.companyName}`,
      react: HoursRejectedByKlantChefEmail({
        recipientName: chefInfo.chefName,
        clientName: client.companyName,
        shiftDate: chefInfo.shiftStart
          ? new Date(chefInfo.shiftStart).toLocaleDateString("nl-NL", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })
          : "—",
        klantNote: reason,
        editUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/chef/hours/${(await db.query.shiftHours.findFirst({ where: eq(shiftHours.id, row.id) }))?.placementId ?? ""}`,
      }),
    });
    if (send.ok) {
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: chefInfo.chefEmail,
        template: "HoursRejectedByKlantChefEmail",
        eventKey: "hours_client_rejected",
        entityType: "shift_hours",
        entityId: row.id,
        userId: chefInfo.chefUserId ?? undefined,
      });
    }
  }

  redirect(`/client/shifts/${row.shiftId}/hours?ok=rejected`);
}

/* -------- page --------------------------------------------------------- */

export default async function ClientHoursPage({
  params,
  searchParams,
}: {
  params: Promise<{ shiftId: string }>;
  searchParams: Promise<{ ok?: string; error?: string; row?: string }>;
}) {
  const { client } = await requireClientSelf();
  const { shiftId } = await params;
  const sp = await searchParams;

  // Load the shift + every shift_hours row on it for this client
  const [shiftRow] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .limit(1);
  if (!shiftRow) notFound();
  if (shiftRow.clientId !== client.id) notFound();

  const rows = await db
    .select({
      h: shiftHours,
      chefName: chefs.fullName,
      chefId: chefs.id,
    })
    .from(shiftHours)
    .innerJoin(chefs, eq(chefs.id, shiftHours.chefId))
    .where(
      and(
        eq(shiftHours.shiftId, shiftId),
        eq(shiftHours.clientId, client.id),
        inArray(shiftHours.status, [
          "submitted",
          "client_signed",
          "client_rejected",
          "admin_approved",
          "admin_rejected",
          "exported",
        ]),
      ),
    )
    .orderBy(asc(chefs.fullName));

  const flashOk =
    sp.ok === "signed"
      ? "✓ Akkoord verstuurd. Chef & Serve controleert nu de uren."
      : sp.ok === "rejected"
        ? "Je opmerking is verstuurd. De chef past de uren aan."
        : null;
  const flashErr =
    sp.error === "reason-required"
      ? "Geef een reden (minimaal 5 tekens) waarom je de uren niet goedkeurt."
      : sp.error === "stale"
        ? "De uren zijn in de tussentijd al verwerkt — vernieuw de pagina."
        : null;

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/client/shifts"
          className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          ← Mijn shifts
        </Link>
      </div>

      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Uren controleren
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        {formatShiftLabel(shiftRow.startsAt)}
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        Gepland: {formatTime(shiftRow.startsAt)} – {formatTime(shiftRow.endsAt)}
        {shiftRow.location ? ` · ${shiftRow.location}` : null}
      </p>

      {flashOk ? (
        <p className="mt-6 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {flashOk}
        </p>
      ) : null}
      {flashErr ? (
        <p className="mt-6 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm text-burgundy">
          {flashErr}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="mt-10 rounded-lg border border-ink-200 bg-white p-8 text-center">
          <p className="font-serif text-lg text-ink-900">
            Nog geen uren ingediend
          </p>
          <p className="mt-2 text-sm text-ink-500">
            De chef vult dit na de shift in. Je krijgt een mail zodra je kunt
            tekenen.
          </p>
        </div>
      ) : (
        <ul className="mt-10 space-y-6">
          {rows.map(({ h, chefName }) => {
            const isPending = h.status === "submitted";
            const expectedAmount = formatEuro(
              computeChefAmountCents(h.workedMinutes, h.chefRateCents),
            );
            const focusReject = sp.row === h.id && sp.error === "reason-required";
            return (
              <li
                key={h.id}
                className="rounded-lg border border-ink-200 bg-white p-6"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-serif text-xl text-ink-900">{chefName}</h2>
                    <p className="mt-1 text-sm text-ink-700">
                      {humanNextAction(h.status, "klant")}
                    </p>
                  </div>
                  <HumanStatusBadge status={h.status} />
                </div>

                {/* Receipt */}
                <div className="mt-5 rounded-lg border border-ink-200 bg-bg-gray p-4 text-sm">
                  <Row label="Ingevuld" value={`${formatTime(h.startedAt)} – ${formatTime(h.endedAt)}`} />
                  <Row label="Pauze" value={`${h.breakMinutes} minuten`} />
                  <Row label="Totaal" value={formatWorkedMinutes(h.workedMinutes)} bold />
                  <Row label="Verwachte vergoeding" value={expectedAmount} />
                  {h.chefNotes ? (
                    <p className="mt-3 rounded border border-ink-200 bg-white px-3 py-2 text-xs italic text-ink-700">
                      Chef-notitie: {h.chefNotes}
                    </p>
                  ) : null}
                </div>

                {/* Timeline */}
                <div className="mt-5">
                  <TrustTimeline steps={timelineDots(h)} />
                </div>

                {/* Actions or read-only callout */}
                {isPending ? (
                  <div className="mt-6 flex flex-wrap items-stretch gap-3">
                    <form action={sign}>
                      <input type="hidden" name="hoursId" value={h.id} />
                      <input type="hidden" name="shiftId" value={shiftId} />
                      <button
                        type="submit"
                        className="rounded-full bg-emerald-600 px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-emerald-700"
                      >
                        ✓ Akkoord
                      </button>
                    </form>
                    <RejectForm
                      hoursId={h.id}
                      shiftId={shiftId}
                      rejectAction={reject}
                      autoFocus={focusReject}
                    />
                  </div>
                ) : h.clientNotes ? (
                  <p className="mt-5 rounded border border-ink-200 bg-bg-gray p-3 text-xs italic text-ink-700">
                    Jouw opmerking: &ldquo;{h.clientNotes}&rdquo;
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* -------- bits --------------------------------------------------------- */

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between border-b border-ink-200/50 py-1.5 last:border-0">
      <span className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
        {label}
      </span>
      <span className={bold ? "font-mono text-base text-ink-900" : "font-mono text-sm text-ink-900"}>
        {value}
      </span>
    </div>
  );
}

function formatShiftLabel(d: Date | string): string {
  return new Date(d).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatTime(d: Date | string): string {
  return new Date(d).toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
