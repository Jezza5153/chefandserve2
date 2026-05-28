/**
 * /chef/hours/[placementId] — the chef hours form.
 *
 * PR-CHEF-1. The "stupid-simple mobile form" from the plan:
 *   - Prefilled with scheduled start/end
 *   - Quick-pick break buttons (Geen / 15 / 30 / Anders)
 *   - Live total worked time + verwachte vergoeding (client-side calc)
 *   - One Submit button. After submit → klant gets email + sees in their portal.
 *
 * Server action `submitHours(formData)` does the trust chain:
 *   - Atomic UPDATE shift_hours WHERE status IN ('draft','client_rejected','admin_rejected')
 *   - Audit
 *   - Enqueue outbox event 'hours.submitted'
 *   - Create notification for klant user
 *   - Send HoursSubmittedKlantEmail + record email message
 */

import { and, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { HoursForm } from "./HoursForm";
import { db } from "@/lib/db/client";
import {
  chefs,
  clients,
  shiftHours,
  shifts,
  users,
} from "@/lib/db/schema";
import { recordAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import {
  createNotification,
  enqueueIntegrationEvent,
  recordEmailMessage,
} from "@/lib/integrations";
import {
  computeChefAmountCents,
  formatWorkedMinutes,
  humanNextAction,
  humanStatus,
} from "@/lib/hours-labels";
import { requireAuth } from "@/lib/permissions";

import { HoursSubmittedKlantEmail } from "@/emails/HoursSubmittedKlantEmail";

export const metadata = { title: "Uren indienen", robots: { index: false } };
export const dynamic = "force-dynamic";

async function submitHours(formData: FormData) {
  "use server";
  const session = await requireAuth();
  const placementId = String(formData.get("placementId") ?? "");
  if (!placementId) redirect("/chef/hours");

  // Resolve chef by session — auth IS the lookup.
  const chef = await db.query.chefs.findFirst({
    where: eq(chefs.userId, session.user.id),
  });
  if (!chef) redirect("/chef");

  // Load the hours row + ownership check.
  const [existing] = await db
    .select({
      id: shiftHours.id,
      chefId: shiftHours.chefId,
      shiftId: shiftHours.shiftId,
      clientId: shiftHours.clientId,
      status: shiftHours.status,
      chefRateCents: shiftHours.chefRateCents,
      clientRateCents: shiftHours.clientRateCents,
    })
    .from(shiftHours)
    .where(eq(shiftHours.placementId, placementId))
    .limit(1);
  if (!existing) redirect("/chef/hours");
  if (existing.chefId !== chef.id) redirect("/chef/hours");

  // Validate inputs.
  const startedAtStr = String(formData.get("startedAt") ?? "");
  const endedAtStr = String(formData.get("endedAt") ?? "");
  const breakMinutesStr = String(formData.get("breakMinutes") ?? "0");
  const chefNotes = String(formData.get("chefNotes") ?? "").trim() || null;

  const startedAt = new Date(startedAtStr);
  const endedAt = new Date(endedAtStr);
  const breakMinutes = Math.max(0, Math.min(480, Number(breakMinutesStr) || 0));

  if (
    !startedAtStr ||
    !endedAtStr ||
    isNaN(startedAt.getTime()) ||
    isNaN(endedAt.getTime()) ||
    endedAt <= startedAt
  ) {
    redirect(`/chef/hours/${placementId}?error=bad-times`);
  }

  const totalMinutes = Math.floor(
    (endedAt.getTime() - startedAt.getTime()) / 60000,
  );
  if (breakMinutes >= totalMinutes) {
    redirect(`/chef/hours/${placementId}?error=break-too-long`);
  }
  const workedMinutes = totalMinutes - breakMinutes;

  // Atomic state transition.
  const updated = await db
    .update(shiftHours)
    .set({
      startedAt,
      endedAt,
      breakMinutes,
      workedMinutes,
      chefNotes,
      status: "submitted",
      submittedAt: new Date(),
      // Reset rejection timestamps if this is a re-submit after reject
      clientRejectedAt: null,
      adminRejectedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(shiftHours.id, existing.id),
        inArray(shiftHours.status, ["draft", "client_rejected", "admin_rejected"]),
      ),
    )
    .returning({ id: shiftHours.id });

  if (updated.length === 0) {
    redirect(`/chef/hours/${placementId}?error=stale`);
  }

  await recordAudit({
    userId: session.user.id,
    action: "shift_hours.submit",
    resource: "shift_hours",
    resourceId: existing.id,
    after: {
      workedMinutes,
      breakMinutes,
      chefRateCents: existing.chefRateCents,
      via: "chef-portal",
    },
  });

  // Outbox event — future Payingit/accounting hooks subscribe to this.
  await enqueueIntegrationEvent({
    provider: "internal",
    eventType: "hours.submitted",
    entityType: "shift_hours",
    entityId: existing.id,
    payload: { placementId, workedMinutes, chefRateCents: existing.chefRateCents },
    idempotencyKey: `hours.submitted:${existing.id}:${Date.now()}`,
  });

  // Find klant user + shift info for the email + notification.
  const [klant] = await db
    .select({
      clientUserId: users.id,
      clientEmail: clients.email,
      clientName: clients.companyName,
      shiftStart: shifts.startsAt,
      shiftEnd: shifts.endsAt,
      shiftId: shifts.id,
    })
    .from(clients)
    .innerJoin(shifts, eq(shifts.id, existing.shiftId))
    .leftJoin(users, eq(users.id, clients.userId))
    .where(eq(clients.id, existing.clientId))
    .limit(1);

  if (klant?.clientUserId) {
    await createNotification({
      userId: klant.clientUserId,
      type: "hours_to_sign",
      title: `Uren te ondertekenen — ${chef.fullName}`,
      body: `Even controleren en akkoord geven.`,
      actionUrl: `/client/shifts/${klant.shiftId}/hours`,
      entityType: "shift_hours",
      entityId: existing.id,
    });
  }

  if (klant?.clientEmail) {
    const send = await sendEmail({
      to: klant.clientEmail,
      subject: `Uren te ondertekenen — ${chef.fullName} op ${new Date(klant.shiftStart).toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}`,
      react: HoursSubmittedKlantEmail({
        recipientName: klant.clientName,
        chefName: chef.fullName,
        shiftDate: new Date(klant.shiftStart).toLocaleDateString("nl-NL", {
          weekday: "long",
          day: "numeric",
          month: "long",
        }),
        scheduledStart: formatTime(klant.shiftStart),
        scheduledEnd: formatTime(klant.shiftEnd),
        actualStart: formatTime(startedAt),
        actualEnd: formatTime(endedAt),
        breakMinutes,
        workedHoursLabel: formatWorkedMinutes(workedMinutes),
        expectedAmountEur:
          computeChefAmountCents(workedMinutes, existing.chefRateCents) / 100,
        signUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/client/shifts/${klant.shiftId}/hours`,
      }),
    });
    if (send.ok) {
      await recordEmailMessage({
        providerMessageId: send.id,
        toEmail: klant.clientEmail,
        template: "HoursSubmittedKlantEmail",
        eventKey: "hours_submitted",
        entityType: "shift_hours",
        entityId: existing.id,
        userId: klant.clientUserId ?? undefined,
      });
    }
  }

  redirect("/chef/hours?ok=submitted");
}

function formatTime(d: Date | string): string {
  return new Date(d).toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function ChefHoursFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ placementId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireAuth();
  const { placementId } = await params;
  const sp = await searchParams;

  const chef = await db.query.chefs.findFirst({
    where: eq(chefs.userId, session.user.id),
  });
  if (!chef) redirect("/chef");

  const [row] = await db
    .select({
      h: shiftHours,
      shift: shifts,
      clientName: clients.companyName,
    })
    .from(shiftHours)
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .where(eq(shiftHours.placementId, placementId))
    .limit(1);

  if (!row) notFound();
  if (row.h.chefId !== chef.id) notFound();

  const isEditable = ["draft", "client_rejected", "admin_rejected"].includes(
    row.h.status,
  );

  const errorMsg =
    sp.error === "bad-times"
      ? "Eindtijd moet later zijn dan starttijd."
      : sp.error === "break-too-long"
        ? "Pauze kan niet langer zijn dan je totale werktijd."
        : sp.error === "stale"
          ? "De status is in de tussentijd veranderd — vernieuw de pagina."
          : null;

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/chef/hours"
          className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          ← Mijn uren
        </Link>
      </div>

      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        {row.clientName}
      </p>
      <h1 className="mt-2 font-serif text-2xl text-ink-900 md:text-3xl">
        Uren invullen
      </h1>
      <p className="mt-2 text-sm text-ink-700">
        {new Date(row.shift.startsAt).toLocaleDateString("nl-NL", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
      </p>
      <p className="mt-1 text-sm text-ink-500">
        Gepland: {formatTime(row.shift.startsAt)} – {formatTime(row.shift.endsAt)}
      </p>

      {/* Rejection callout */}
      {row.h.status === "client_rejected" && row.h.clientNotes ? (
        <div className="mt-6 rounded-lg border-l-4 border-burgundy bg-burgundy/5 p-4">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Klant niet akkoord
          </p>
          <p className="mt-2 text-sm italic text-ink-900">
            &ldquo;{row.h.clientNotes}&rdquo;
          </p>
          <p className="mt-2 text-xs text-ink-700">
            Pas je uren aan en dien opnieuw in.
          </p>
        </div>
      ) : null}
      {row.h.status === "admin_rejected" && row.h.adminNotes ? (
        <div className="mt-6 rounded-lg border-l-4 border-burgundy bg-burgundy/5 p-4">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Chef &amp; Serve heeft je uren teruggezet
          </p>
          <p className="mt-2 text-sm italic text-ink-900">
            &ldquo;{row.h.adminNotes}&rdquo;
          </p>
          <p className="mt-2 text-xs text-ink-700">
            Pas je uren aan en dien opnieuw in.
          </p>
        </div>
      ) : null}

      {!isEditable ? (
        <div className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Status
          </p>
          <p className="mt-2 text-sm text-ink-900">{humanStatus(row.h.status)}</p>
          <p className="mt-2 text-sm text-ink-700">
            {humanNextAction(row.h.status, "chef")}
          </p>
        </div>
      ) : (
        <HoursForm
          placementId={placementId}
          defaultStart={toDatetimeLocal(row.h.startedAt)}
          defaultEnd={toDatetimeLocal(row.h.endedAt)}
          defaultBreakMinutes={row.h.breakMinutes}
          defaultNotes={row.h.chefNotes ?? ""}
          chefRateCents={row.h.chefRateCents}
          submitAction={submitHours}
          errorMsg={errorMsg}
        />
      )}
    </div>
  );
}

function toDatetimeLocal(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  // datetime-local input expects YYYY-MM-DDTHH:mm without seconds or tz
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}
