/**
 * /chef/shifts/[placementId] — shift detail + accept/reject + cancel + contact.
 *
 * PR-CHEF-5 additions:
 *   - Cancel-shift flow with severity tiers (safe / caution / urgent)
 *   - Urgent tier shows "Bel Maarten" tel: CTA
 *   - Contact card with klant phone + Google Maps route + WhatsApp link
 *   - Rejection reason (<details> reveal) on the Niet beschikbaar button
 *   - When cancel fires: outbox event + emails to Maarten (routable) + klant
 */

import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CancelShiftSection } from "./CancelShiftSection";
import { RejectWithReason } from "./RejectWithReason";
import { db } from "@/lib/db/client";
import {
  chefs,
  clients,
  placements,
  shifts,
} from "@/lib/db/schema";
import { recordAuditFromRequest } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import {
  createNotificationsFanOut,
  enqueueIntegrationEvent,
  recordEmailMessage,
} from "@/lib/integrations";
import { tierForShift } from "@/lib/cancellation-severity";
import { formatShiftRole, formatSegment } from "@/lib/labels";
import { recordChefEvent, diffSeconds } from "@/lib/chef-events";
import { recipientsFor } from "@/lib/notifications";
import { recipientsForClient } from "@/lib/domain/client-recipients";
import { requireAuth } from "@/lib/permissions";

import { ShiftCancelledByChefClientEmail } from "@/emails/ShiftCancelledByChefClientEmail";

export const metadata = { title: "Shift" };

/* -------- server action: accept or reject ---------------------------- */

async function respond(formData: FormData) {
  "use server";
  const session = await requireAuth();
  const decision = String(formData.get("decision") ?? "") as
    | "accepted"
    | "rejected";
  const placementId = String(formData.get("placementId") ?? "");
  const rejectionReason = String(formData.get("rejectionReason") ?? "").trim();
  const declineReason = String(formData.get("declineReason") ?? "").trim() || null;
  if (decision !== "accepted" && decision !== "rejected") return;
  if (!placementId) return;

  // Auth IS the lookup — resolve the caller's chef and scope every read/write to
  // it. Without this, any authenticated user could accept/reject another chef's
  // placement by POSTing an arbitrary placementId (IDOR). Mirrors `cancel` below.
  const chef = await db.query.chefs.findFirst({
    where: eq(chefs.userId, session.user.id),
  });
  if (!chef) redirect("/chef");

  // Placement context — for the rejection-note append + the chef-event signal.
  // Scoped to THIS chef's own placement.
  const [pl] = await db
    .select({
      notes: placements.notes,
      chefId: placements.chefId,
      proposedAt: placements.proposedAt,
      shiftId: placements.shiftId,
    })
    .from(placements)
    .where(and(eq(placements.id, placementId), eq(placements.chefId, chef.id)))
    .limit(1);

  let appendedNotes: string | null = null;
  if (decision === "rejected" && rejectionReason.length > 0) {
    const prefix = pl?.notes ? `${pl.notes}\n\n` : "";
    appendedNotes = `${prefix}[Chef-afwijzing reden] ${rejectionReason}`;
  }

  // Atomic, ownership-scoped transition: only the owning chef may respond, and
  // only while the placement is still 'proposed'. 0 rows → not yours/already decided.
  const updated = await db
    .update(placements)
    .set({
      status: decision,
      respondedAt: new Date(),
      updatedAt: new Date(),
      ...(appendedNotes ? { notes: appendedNotes } : {}),
      // PR-INTEL: the structured 1-tap reason → preference signal for Maarten/AI.
      ...(decision === "rejected" && declineReason ? { declineReason } : {}),
    })
    .where(
      and(
        eq(placements.id, placementId),
        eq(placements.chefId, chef.id),
        eq(placements.status, "proposed"),
      ),
    )
    .returning({ id: placements.id });
  if (updated.length === 0) {
    redirect(`/chef/shifts/${placementId}?error=stale`);
  }

  await recordAuditFromRequest({
    userId: session.user.id,
    action: `placements.chef_${decision}`,
    resource: "placements",
    resourceId: placementId,
    after: rejectionReason ? { rejectionReason } : null,
  });

  // PR-CHEF-5 — structured signal for Maarten/AI (best-effort, never blocks).
  if (pl?.chefId) {
    await recordChefEvent({
      chefId: pl.chefId,
      eventType: decision === "accepted" ? "proposal_accepted" : "proposal_rejected",
      entityType: "placement",
      entityId: placementId,
      responseSeconds: pl.proposedAt
        ? diffSeconds(new Date(pl.proposedAt), new Date())
        : null,
      payload: {
        decision,
        shiftId: pl.shiftId,
        ...(rejectionReason ? { rejectionReason } : {}),
        ...(declineReason ? { declineReason } : {}),
      },
    });
  }

  redirect("/chef");
}

/* -------- server action: cancel after acceptance --------------------- */

async function cancel(formData: FormData) {
  "use server";
  const session = await requireAuth();
  const placementId = String(formData.get("placementId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!placementId || reason.length < 5) {
    redirect(`/chef/shifts/${placementId}?error=reason-required`);
  }

  // Ownership check via chefs.userId
  const chef = await db.query.chefs.findFirst({
    where: eq(chefs.userId, session.user.id),
  });
  if (!chef) redirect("/chef");

  const placement = await db.query.placements.findFirst({
    where: eq(placements.id, placementId),
  });
  if (!placement) redirect("/chef");
  if (placement.chefId !== chef.id) redirect("/chef");
  if (!["accepted", "confirmed"].includes(placement.status)) {
    redirect(`/chef/shifts/${placementId}?error=cannot-cancel`);
  }

  // Append the reason to notes (placements has no cancelledReason column —
  // we keep Maarten's existing notes intact and prepend a labeled entry).
  const prevNotes = placement.notes ? `${placement.notes}\n\n` : "";
  const updated = await db
    .update(placements)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      notes: `${prevNotes}[Chef-annulering reden] ${reason}`,
      updatedAt: new Date(),
    })
    .where(eq(placements.id, placementId))
    .returning({ id: placements.id, shiftId: placements.shiftId });
  if (updated.length === 0) {
    redirect(`/chef/shifts/${placementId}?error=stale`);
  }

  await recordAuditFromRequest({
    userId: session.user.id,
    action: "placements.chef_cancelled",
    resource: "placements",
    resourceId: placementId,
    after: { reason, fromStatus: placement.status },
  });

  await enqueueIntegrationEvent({
    provider: "internal",
    eventType: "placement.cancelled_by_chef",
    entityType: "placement",
    entityId: placementId,
    payload: { reason, chefId: chef.id, shiftId: updated[0].shiftId },
    idempotencyKey: `placement.cancelled_by_chef:${placementId}`,
  });

  // PR-CHEF-5 — structured signal (best-effort).
  await recordChefEvent({
    chefId: chef.id,
    eventType: "shift_cancelled_by_chef",
    entityType: "placement",
    entityId: placementId,
    payload: { reason, fromStatus: placement.status, shiftId: updated[0].shiftId },
  });

  // Load context for emails
  const [ctx] = await db
    .select({
      shiftStart: shifts.startsAt,
      shiftEnd: shifts.endsAt,
      clientName: clients.companyName,
      clientEmail: clients.email,
      clientContact: clients.contactName,
      clientUserId: clients.userId,
      clientId: clients.id,
    })
    .from(shifts)
    .innerJoin(clients, eq(clients.id, shifts.clientId))
    .where(eq(shifts.id, updated[0].shiftId))
    .limit(1);

  if (ctx) {
    const hoursUntil =
      (new Date(ctx.shiftStart).getTime() - Date.now()) / (1000 * 60 * 60);
    const shiftDate = new Date(ctx.shiftStart).toLocaleDateString("nl-NL", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    // Email klant — PR-AUDIT-2: route via recipientsForClient (single seam +
    // contact routing). Urgent operational cancel → "generic" (always sends).
    const klantTo = await recipientsForClient(ctx.clientId, "generic");
    if (klantTo.length > 0) {
      const send = await sendEmail({
        to: klantTo,
        subject: `Chef heeft geannuleerd — ${shiftDate}`,
        react: ShiftCancelledByChefClientEmail({
          clientContactName: ctx.clientContact,
          companyName: ctx.clientName,
          chefName: chef.fullName,
          shiftWhen: shiftDate,
          reason,
          hoursUntilShift: hoursUntil,
          hubUrl: `${process.env.NEXT_PUBLIC_APP_URL}/client/shifts/${updated[0].shiftId}`,
        }),
      });
      if (send.ok) {
        for (const to of klantTo) {
          await recordEmailMessage({
            providerMessageId: send.id,
            toEmail: to,
            template: "ShiftCancelledByChefClientEmail",
            eventKey: "placement_chef_cancelled",
            entityType: "placement",
            entityId: placementId,
            userId: ctx.clientUserId ?? undefined,
          });
        }
      }
    }

    // Admin notification (routable — uses existing chef_submission_received fallback)
    const adminEmails = await recipientsFor("chef_submission_received");
    if (adminEmails.length > 0) {
      const urgentNote =
        hoursUntil < 24
          ? `🚨 ${Math.round(hoursUntil)}u tot start — direct vervanging zoeken.`
          : hoursUntil < 48
            ? `⚠️ ${Math.round(hoursUntil)}u tot start.`
            : `${Math.round(hoursUntil)}u tot start.`;
      const send = await sendEmail({
        to: adminEmails,
        subject: `Chef-annulering: ${chef.fullName} bij ${ctx.clientName} (${shiftDate})`,
        react: (
          <div>
            <h1>Chef heeft geannuleerd</h1>
            <p>
              <strong>{chef.fullName}</strong> heeft de shift bij{" "}
              <strong>{ctx.clientName}</strong> op {shiftDate} geannuleerd.
            </p>
            <p>{urgentNote}</p>
            <p>
              <strong>Reden:</strong> {reason}
            </p>
            <p>
              Open shift in admin:{" "}
              <a
                href={`${process.env.NEXT_PUBLIC_APP_URL}/admin/business/shifts/${updated[0].shiftId}`}
              >
                shift-detail
              </a>
              .
            </p>
          </div>
        ),
      });
      if (send.ok && ctx.clientUserId) {
        await recordEmailMessage({
          providerMessageId: send.id,
          toEmail: adminEmails[0],
          template: "AdminChefCancellationEmail",
          eventKey: "placement_chef_cancelled",
          entityType: "placement",
          entityId: placementId,
        });
      }
    }

    // In-app for klant
    if (ctx.clientUserId) {
      await createNotificationsFanOut([ctx.clientUserId], {
        type: "shift_cancelled_by_chef",
        title: `${chef.fullName} heeft geannuleerd`,
        body: `Shift op ${shiftDate} · Chef & Serve zoekt vervanging.`,
        actionUrl: `/client/shifts`,
        entityType: "placement",
        entityId: placementId,
      });
    }
  }

  redirect("/chef?cancelled=1");
}

/* -------- server action: post-shift return-thumb (PR-INTEL-P5) -------- */
/* OBSERVE/NUDGE: one tap after a worked shift → placements.chef_return_signal.
   Internal preference signal — feeds match.intel (the chef×klant fit the AI
   reads). Never shown to klanten. Ownership-scoped; the chef can change it. */

async function recordReturnSignal(formData: FormData) {
  "use server";
  const session = await requireAuth();
  const placementId = String(formData.get("placementId") ?? "");
  const signal = String(formData.get("signal") ?? "");
  if (!placementId || (signal !== "up" && signal !== "down")) {
    redirect(`/chef/shifts/${placementId}`);
  }

  // Auth IS the lookup — scope the write to the caller's own placement.
  const chef = await db.query.chefs.findFirst({
    where: eq(chefs.userId, session.user.id),
  });
  if (!chef) redirect("/chef");

  const updated = await db
    .update(placements)
    .set({ chefReturnSignal: signal === "up", updatedAt: new Date() })
    .where(and(eq(placements.id, placementId), eq(placements.chefId, chef.id)))
    .returning({ id: placements.id });
  if (updated.length === 0) {
    redirect(`/chef/shifts/${placementId}?error=stale`);
  }

  await recordAuditFromRequest({
    userId: session.user.id,
    action: "placements.chef_return_signal",
    resource: "placements",
    resourceId: placementId,
    after: { returnSignal: signal === "up" },
  });

  redirect(`/chef/shifts/${placementId}`);
}

/* -------- page ------------------------------------------------------- */

export default async function ChefShiftDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ placementId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireAuth();
  const { placementId } = await params;
  const sp = await searchParams;

  const placement = await db.query.placements.findFirst({
    where: eq(placements.id, placementId),
  });
  if (!placement) notFound();

  const chef = await db.query.chefs.findFirst({
    where: eq(chefs.id, placement.chefId),
  });
  if (!chef || chef.userId !== session.user.id) {
    if (!session.user.roles.includes("super_admin")) notFound();
  }

  const shift = await db.query.shifts.findFirst({
    where: eq(shifts.id, placement.shiftId),
  });
  if (!shift) notFound();
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, shift.clientId),
  });

  const errorMsg =
    sp.error === "reason-required"
      ? "Geef een reden (minimaal 5 tekens)."
      : sp.error === "cannot-cancel"
        ? "Deze shift kun je niet meer annuleren."
        : sp.error === "stale"
          ? "Status is in de tussentijd veranderd."
          : null;

  const tier = tierForShift(shift.startsAt);
  const canCancel = ["accepted", "confirmed"].includes(placement.status);
  // PR-INTEL-P5: ask the return-thumb once the chef has actually worked here
  // (shift ended + they were committed). The answer feeds match.intel.
  const isPastWorked =
    new Date(shift.endsAt).getTime() < Date.now() &&
    ["accepted", "confirmed", "completed"].includes(placement.status);

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/chef"
          className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          ← Dashboard
        </Link>
      </div>

      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        {placement.status === "proposed" ? "Shift-voorstel" : "Shift"}
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        {formatShiftRole(shift.roleNeeded)}
        {shift.segment && (
          <span className="ml-2 text-ink-500">· {formatSegment(shift.segment)}</span>
        )}
      </h1>
      <p className="mt-2 text-sm text-ink-700">{client?.companyName ?? "—"}</p>

      {errorMsg ? (
        <p className="mt-4 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
          {errorMsg}
        </p>
      ) : null}

      {/* Shift details */}
      <div className="mt-8 grid gap-3 rounded-lg border border-ink-200 bg-white p-6">
        <Row label="Wanneer" value={formatRange(shift.startsAt, shift.endsAt)} />
        <Row label="Locatie" value={shift.location ?? shift.city ?? "—"} />
        <Row
          label="Vergoeding"
          value={
            shift.chefRateCents
              ? `€${(shift.chefRateCents / 100).toFixed(2)} per uur`
              : "Nog te bevestigen door Chef & Serve"
          }
        />
        {/* PR-CHEF-2b: only the chef-visible channel is shown — never shift.notes. */}
        {shift.chefVisibleNotes ? (
          <Row label="Info van Chef & Serve" value={shift.chefVisibleNotes} />
        ) : null}
      </div>

      {/* Contact card — only when accepted/confirmed (chef has earned the contact) */}
      {client && ["accepted", "confirmed"].includes(placement.status) && (
        <ContactCard
          name={client.contactName ?? client.companyName}
          phone={client.phone}
          address={shift.location ?? `${client.address ?? ""} ${client.city ?? ""}`.trim()}
        />
      )}

      {/* Decision form (proposed only) */}
      {placement.status === "proposed" ? (
        <section className="mt-8">
          <h2 className="font-serif text-xl text-ink-900">Wil je deze shift?</h2>
          <p className="mt-1 text-sm text-ink-700">
            Reageer zo snel mogelijk. Maarten ziet je antwoord direct.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <form action={respond}>
              <input type="hidden" name="placementId" value={placement.id} />
              <input type="hidden" name="decision" value="accepted" />
              <button
                type="submit"
                className="rounded-full bg-emerald-600 px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-emerald-700"
              >
                ✓ Ja, ik kom
              </button>
            </form>
            <RejectWithReason placementId={placement.id} respondAction={respond} />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-500">
            Als je accepteert, rekent Maarten op je. Kun je toch niet? Laat het
            direct weten.
          </p>
        </section>
      ) : (
        <section className="mt-8 rounded-lg border border-ink-200 bg-white p-4 text-sm text-ink-700">
          Status:{" "}
          <strong className="text-ink-900">{labelFor(placement.status)}</strong>
          {placement.respondedAt &&
            ` · gereageerd ${new Date(placement.respondedAt).toLocaleDateString("nl-NL")}`}
        </section>
      )}

      {/* Cancel section (accepted/confirmed only) */}
      {canCancel && (
        <CancelShiftSection
          placementId={placement.id}
          tier={tier}
          cancelAction={cancel}
        />
      )}

      {/* Post-shift return-thumb (PR-INTEL-P5) — worked-here, now past */}
      {isPastWorked && (
        <ReturnSignalSection
          placementId={placement.id}
          current={placement.chefReturnSignal}
          action={recordReturnSignal}
        />
      )}
    </div>
  );
}

/* -------- helpers ---------------------------------------------------- */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
        {label}
      </p>
      <p className="mt-1 text-sm text-ink-900">{value}</p>
    </div>
  );
}

function formatRange(start: Date, end: Date): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })}, ${s.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}–${e.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
}

function labelFor(status: string): string {
  return (
    {
      proposed: "Voorgesteld",
      accepted: "Geaccepteerd",
      confirmed: "Bevestigd",
      rejected: "Afgewezen",
      cancelled: "Geannuleerd",
      completed: "Afgerond",
      no_show: "No-show",
    } as Record<string, string>
  )[status] ?? status;
}

function ReturnSignalSection({
  placementId,
  current,
  action,
}: {
  placementId: string;
  current: boolean | null;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="mt-8 rounded-lg border border-ink-200 bg-white p-5">
      <h2 className="font-serif text-xl text-ink-900">Zou je hier terugkomen?</h2>
      <p className="mt-1 text-sm text-ink-700">
        Eén tik — alleen Maarten ziet dit. Het helpt om jou bij de juiste plekken
        in te delen.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <form action={action}>
          <input type="hidden" name="placementId" value={placementId} />
          <input type="hidden" name="signal" value="up" />
          <button
            type="submit"
            className={`rounded-full px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] ${
              current === true
                ? "bg-emerald-600 text-white"
                : "border border-emerald-600/40 bg-white text-emerald-700 hover:bg-emerald-50"
            }`}
          >
            👍 Graag weer
          </button>
        </form>
        <form action={action}>
          <input type="hidden" name="placementId" value={placementId} />
          <input type="hidden" name="signal" value="down" />
          <button
            type="submit"
            className={`rounded-full px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] ${
              current === false
                ? "bg-burgundy text-white"
                : "border border-burgundy/40 bg-white text-burgundy hover:bg-burgundy/5"
            }`}
          >
            👎 Liever niet
          </button>
        </form>
      </div>
      {current !== null && (
        <p className="mt-3 text-xs text-ink-500">
          Bedankt — je kunt dit altijd aanpassen.
        </p>
      )}
    </section>
  );
}

function ContactCard({
  name,
  phone,
  address,
}: {
  name: string;
  phone: string | null;
  address: string | null;
}) {
  return (
    <div className="mt-8 rounded-lg border border-burgundy/20 bg-burgundy/5 p-5">
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
        Contact
      </p>
      <p className="mt-1 font-serif text-base text-ink-900">{name}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {phone ? (
          <>
            <a
              href={`tel:${phone.replace(/[^+\d]/g, "")}`}
              className="rounded-full bg-burgundy px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900"
            >
              Bel · {phone}
            </a>
            <a
              href={`https://wa.me/${phone.replace(/[^\d]/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-burgundy/40 bg-white px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5"
            >
              WhatsApp
            </a>
          </>
        ) : null}
        {address ? (
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-burgundy/40 bg-white px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5"
          >
            Route openen
          </a>
        ) : null}
      </div>
    </div>
  );
}
