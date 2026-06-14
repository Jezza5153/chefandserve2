/**
 * /client/shifts/[shiftId] — THE klant shift hub (PR-KLANT-0 keystone).
 *
 * The hotel's single source of truth for one shift. Sections in fixed order:
 *   1. Header (klant + date/time + role + location)
 *   2. Status + "Wat gebeurt er nu?"
 *   3. Chefs voor deze shift (proposed/confirmed/cancelled cards)
 *   4. Uren (link + status)
 *   5. Feedback (link when applicable)
 *   6. Acties (Wijziging / Annulering aanvragen — always available)
 *   7. Berichten (client_visible placement_comments)
 *
 * PR-KLANT-0 ships the skeleton + real status/chefs/hours/comments. The
 * interactive bits (comment form, change/cancel modals, rating link) get
 * wired by PR-KLANT-2/3/5 — the section placeholders show "binnenkort"
 * until then so the hub is never a dead end.
 */

import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ChangeRequestModal } from "./ChangeRequestModal";
import { CancelRequestModal } from "./CancelRequestModal";
import { ChefAvatar } from "./ChefAvatar";
import { ChefFeedbackForm } from "./ChefFeedbackForm";
import { WhatHappensNext } from "@/components/client/WhatHappensNext";
import { db } from "@/lib/db/client";
import {
  chefDocuments,
  chefs,
  clients,
  clientShiftChangeRequests,
  placements,
  shiftHours,
  shifts,
} from "@/lib/db/schema";
import { actionAllowed, getClientShiftLabel } from "@/lib/client-shift-labels";
import { formatChefRole } from "@/lib/labels";
import { addPlacementComment, listVisibleComments } from "@/lib/domain/comments";
import { getMatchReasonsForPlacement } from "@/lib/domain/matching";
import { createShiftChangeRequest } from "@/lib/domain/shift-change-requests";
import { sendEmail } from "@/lib/email";
import { recordEmailMessage } from "@/lib/integrations";
import { recipientsFor } from "@/lib/notifications";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Shift", robots: { index: false } };
export const dynamic = "force-dynamic";

async function requireClientSelf() {
  const session = await requireAuth();
  if (session.user.kind !== "client" && !session.user.roles.includes("super_admin")) {
    redirect("/");
  }
  const [c] = await db
    .select({ id: clients.id, companyName: clients.companyName })
    .from(clients)
    .where(eq(clients.userId, session.user.id))
    .limit(1);
  if (!c) redirect("/client");
  return { client: c, session };
}

export default async function ClientShiftHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ shiftId: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { client, session } = await requireClientSelf();
  const { shiftId } = await params;
  const sp = await searchParams;

  const [shift] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .limit(1);
  if (!shift) notFound();
  if (shift.clientId !== client.id) notFound();

  // Server action: file a change OR cancel request (kind from the form).
  async function requestShiftChangeAction(formData: FormData) {
    "use server";
    const kind = String(formData.get("kind") ?? "") === "cancel" ? "cancel" : "change";
    const reason = String(formData.get("reason") ?? "");
    const topic = String(formData.get("topic") ?? "") || null;
    const res = await createShiftChangeRequest({
      shiftId,
      clientId: client.id,
      requestedBy: session.user.id,
      kind,
      reason,
      proposedChange: topic ? { topic } : null,
    });
    redirect(
      res.ok
        ? `/client/shifts/${shiftId}?ok=${kind}`
        : `/client/shifts/${shiftId}?err=${res.error}`,
    );
  }

  // Server action: klant sends an opmerking about a proposed chef. Writes a
  // placement_comments row (visibility='client_visible'), NEVER placements.notes.
  async function sendChefComment(formData: FormData) {
    "use server";
    const placementId = String(formData.get("placementId") ?? "");
    const body = String(formData.get("body") ?? "");
    if (!placementId) redirect(`/client/shifts/${shiftId}`);

    // Ownership: the placement must be on THIS shift, owned by THIS client.
    const [own] = await db
      .select({ id: placements.id })
      .from(placements)
      .innerJoin(shifts, eq(shifts.id, placements.shiftId))
      .where(
        and(
          eq(placements.id, placementId),
          eq(placements.shiftId, shiftId),
          eq(shifts.clientId, client.id),
        ),
      )
      .limit(1);
    if (!own) redirect(`/client/shifts/${shiftId}?err=not_found`);

    const res = await addPlacementComment({
      placementId,
      authorUserId: session.user.id,
      authorKind: "client",
      visibility: "client_visible",
      body,
    });

    // Notify admins so they see the klant's opmerking before confirming.
    if (res.ok) {
      const adminEmails = await recipientsFor("client_portal_request");
      if (adminEmails.length > 0) {
        const send = await sendEmail({
          to: adminEmails,
          subject: `Opmerking van ${client.companyName} bij een voorgestelde chef`,
          react: (
            <div>
              <h1>{`${client.companyName} stuurde een opmerking`}</h1>
              <p>{body.trim().slice(0, 1000)}</p>
              <p>
                Bekijk + reageer:{" "}
                <a
                  href={`${process.env.NEXT_PUBLIC_APP_URL}/admin/business/shifts/${shiftId}`}
                >
                  shift-detail
                </a>
                .
              </p>
            </div>
          ),
        });
        if (send.ok) {
          for (const to of adminEmails) {
            await recordEmailMessage({
              providerMessageId: send.id,
              toEmail: to,
              template: "ClientCommentAdminInline",
              eventKey: "client_portal_request",
              entityType: "placements",
              entityId: placementId,
            });
          }
        }
      }
    }

    redirect(
      res.ok
        ? `/client/shifts/${shiftId}?ok=comment`
        : `/client/shifts/${shiftId}?err=comment`,
    );
  }

  // Open change/cancel requests for this shift (one per kind max).
  const openRequests = await db
    .select({ kind: clientShiftChangeRequests.kind })
    .from(clientShiftChangeRequests)
    .where(
      and(
        eq(clientShiftChangeRequests.shiftId, shiftId),
        inArray(clientShiftChangeRequests.status, ["pending", "in_progress"]),
      ),
    );
  const hasOpenChange = openRequests.some((r) => r.kind === "change");
  const hasOpenCancel = openRequests.some((r) => r.kind === "cancel");

  // All placements on this shift + chef + hours
  const placementRows = await db
    .select({
      p: placements,
      chefName: chefs.fullName,
      chefVakniveau: chefs.vakniveau,
      chefYears: chefs.yearsExperience,
      chefPhone: chefs.phone,
    })
    .from(placements)
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .where(eq(placements.shiftId, shiftId))
    .orderBy(desc(placements.createdAt));

  // Hours rows for this shift (one per placement at most)
  const hoursRows = await db
    .select({ placementId: shiftHours.placementId, status: shiftHours.status })
    .from(shiftHours)
    .where(eq(shiftHours.shiftId, shiftId));
  const hoursByPlacement = new Map(hoursRows.map((h) => [h.placementId, h.status]));

  // "Waarom voorgesteld?" reasons — only for proposed placements (klant-safe).
  const proposedPlacements = placementRows.filter((r) => r.p.status === "proposed");
  const reasonsEntries = await Promise.all(
    proposedPlacements.map(
      async (r) => [r.p.id, await getMatchReasonsForPlacement(r.p.id)] as const,
    ),
  );
  const reasonsByPlacement = new Map(reasonsEntries);

  // clientVisible + verified photo doc per chef on this shift (PR-KLANT-3 /
  // photo authz). The /api/chef-photo route enforces the same gate server-side.
  const chefIds = [...new Set(placementRows.map((r) => r.p.chefId))];
  const photoRows = chefIds.length
    ? await db
        .select({ chefId: chefDocuments.chefId, id: chefDocuments.id })
        .from(chefDocuments)
        .where(
          and(
            inArray(chefDocuments.chefId, chefIds),
            eq(chefDocuments.type, "photo"),
            eq(chefDocuments.clientVisible, true),
            isNotNull(chefDocuments.verifiedAt),
            isNull(chefDocuments.deletedAt),
          ),
        )
        .orderBy(desc(chefDocuments.createdAt))
    : [];
  const photoByChef = new Map<string, string>();
  for (const p of photoRows) if (!photoByChef.has(p.chefId)) photoByChef.set(p.chefId, p.id);

  // Best (most-progressed) placement for the headline status
  const rank = (s: string) =>
    ["proposed", "accepted", "confirmed", "completed", "cancelled", "rejected", "no_show"].indexOf(s);
  const best = [...placementRows].sort((a, b) => rank(b.p.status) - rank(a.p.status))[0];
  const bestHours = best ? hoursByPlacement.get(best.p.id) ?? null : null;

  const label = getClientShiftLabel({
    shiftStatus: shift.status,
    hasPlacement: Boolean(best),
    placementStatus: best?.p.status ?? null,
    hoursStatus: bestHours,
  });

  // Comments visible to the klant across all placements on this shift
  const commentBlocks = await Promise.all(
    placementRows.map((r) =>
      listVisibleComments(r.p.id, { kind: "client" }),
    ),
  );
  const clientComments = commentBlocks.flat();

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

      {/* 1. Header */}
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Shift
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        {shift.roleNeeded}
        {shift.segment ? <span className="text-ink-500"> · {shift.segment}</span> : null}
      </h1>
      <p className="mt-2 text-sm text-ink-700">{formatRange(shift.startsAt, shift.endsAt)}</p>
      {shift.location ? (
        <p className="mt-1 text-sm text-ink-500">{shift.location}</p>
      ) : null}

      {sp.ok === "change" || sp.ok === "cancel" ? (
        <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          ✓ Je {sp.ok === "cancel" ? "annulerings" : "wijzigings"}verzoek is
          verstuurd. Chef &amp; Serve neemt contact met je op.
        </p>
      ) : null}
      {sp.ok === "comment" ? (
        <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          ✓ Je opmerking is verstuurd. Chef &amp; Serve neemt die mee.
        </p>
      ) : null}
      {sp.ok === "rated" ? (
        <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          ✓ Bedankt voor je feedback over de chef. Chef &amp; Serve neemt die mee.
        </p>
      ) : null}
      {sp.err === "duplicate" ? (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Je hebt al een verzoek van dit type openstaan voor deze shift. We
          nemen dit mee en koppelen z.s.m. terug.
        </p>
      ) : null}
      {sp.err && sp.err !== "duplicate" ? (
        <p className="mt-4 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
          Er ging iets mis bij het versturen. Probeer het opnieuw of bel het
          kantoor.
        </p>
      ) : null}

      {/* 2. Status + Wat gebeurt er nu? */}
      <div className="mt-6">
        <WhatHappensNext
          humanStatus={label.humanStatus}
          nextStep={label.nextStep}
          tone={
            label.allowedActions.includes("sign_hours") ||
            label.allowedActions.includes("rate_chef")
              ? "action"
              : label.humanStatus === "Afgerond"
                ? "done"
                : "neutral"
          }
        />
      </div>

      {/* 3. Chefs */}
      <section className="mt-8">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Chef{placementRows.length === 1 ? "" : "s"} voor deze shift
        </h2>
        {placementRows.length === 0 ? (
          <p className="mt-3 rounded-lg border border-ink-200 bg-white p-5 text-sm text-ink-500">
            Nog geen chef voorgesteld. Chef &amp; Serve zoekt een match.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {placementRows.map(({ p, chefName, chefVakniveau, chefYears }) => (
              <li
                key={p.id}
                className={`rounded-lg border p-5 ${
                  ["cancelled", "rejected", "no_show"].includes(p.status)
                    ? "border-ink-200 bg-bg-gray opacity-70"
                    : "border-ink-200 bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <ChefAvatar
                      photoId={photoByChef.get(p.chefId) ?? null}
                      name={chefName}
                    />
                    <div>
                      <h3 className="font-serif text-lg text-ink-900">{chefName}</h3>
                      <p className="mt-0.5 text-sm text-ink-500">
                        {formatChefRole(chefVakniveau)}
                        {chefYears ? ` · ${chefYears} jaar ervaring` : ""}
                      </p>
                    </div>
                  </div>
                  <PlacementPill status={p.status} />
                </div>
                {p.status === "proposed" ? (
                  <div className="mt-3">
                    <p className="text-xs text-ink-500">
                      Dit is het voorstel dat Chef &amp; Serve nu bekijkt. Je kunt
                      een opmerking meesturen — Maarten of Gina neemt die mee
                      vóór de shift definitief wordt bevestigd.
                    </p>
                    {(reasonsByPlacement.get(p.id) ?? []).length > 0 ? (
                      <div className="mt-3">
                        <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
                          Waarom voorgesteld?
                        </p>
                        <ul className="mt-1.5 space-y-1">
                          {(reasonsByPlacement.get(p.id) ?? []).map((reason) => (
                            <li
                              key={reason}
                              className="flex items-start gap-2 text-sm text-ink-700"
                            >
                              <span className="mt-1 text-burgundy">•</span>
                              {reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <ChefFeedbackForm placementId={p.id} action={sendChefComment} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4. Uren */}
      <section className="mt-8">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Uren
        </h2>
        {bestHours ? (
          <Link
            href={`/client/shifts/${shiftId}/hours`}
            className="mt-3 flex items-center justify-between rounded-lg border border-ink-200 bg-white p-4 hover:border-burgundy/40"
          >
            <span className="text-sm text-ink-900">Bekijk &amp; controleer uren</span>
            <span className="font-ui text-[10px] uppercase tracking-[0.15em] text-burgundy">
              Open →
            </span>
          </Link>
        ) : (
          <p className="mt-3 rounded-lg border border-ink-200 bg-bg-gray p-4 text-sm text-ink-500">
            Nog geen uren ingediend. De chef vult dit in na de shift.
          </p>
        )}
      </section>

      {/* 5. Feedback */}
      {actionAllowed(label, "rate_chef") && best ? (
        <section className="mt-8">
          <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Feedback
          </h2>
          <Link
            href={`/client/shifts/${shiftId}/rate`}
            className="mt-3 flex items-center justify-between rounded-lg border border-ink-200 bg-white p-4 hover:border-burgundy/40"
          >
            <span className="text-sm text-ink-900">
              Geef feedback over {best.chefName}
            </span>
            <span className="font-ui text-[10px] uppercase tracking-[0.15em] text-burgundy">
              Geef feedback →
            </span>
          </Link>
          <p className="mt-1 text-xs text-ink-500">
            Alleen zichtbaar voor Chef &amp; Serve.
          </p>
        </section>
      ) : null}

      {/* 6. Acties — always present so the hub never traps the klant */}
      <section className="mt-8">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Acties
        </h2>
        <div className="mt-3 flex flex-wrap items-start gap-2">
          <ChangeRequestModal
            action={requestShiftChangeAction}
            hasOpenRequest={hasOpenChange}
          />
          <CancelRequestModal
            action={requestShiftChangeAction}
            hasOpenRequest={hasOpenCancel}
          />
        </div>
        {hasOpenChange || hasOpenCancel ? (
          <p className="mt-2 text-xs text-ink-500">
            Je hebt al een verzoek openstaan voor deze shift. We koppelen z.s.m.
            terug — je vindt de status onder{" "}
            <Link href="/client/requests" className="text-burgundy hover:underline">
              Mijn aanvragen
            </Link>
            .
          </p>
        ) : (
          <p className="mt-2 text-xs text-ink-500">
            Iets wijzigen of de shift annuleren? Dien een verzoek in — Chef &amp;
            Serve stemt het af met de ingeplande chef.
          </p>
        )}
      </section>

      {/* 7. Berichten */}
      {clientComments.length > 0 ? (
        <section className="mt-8">
          <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Berichten
          </h2>
          <ul className="mt-3 space-y-2">
            {clientComments.map((c) => (
              <li
                key={c.id}
                className="rounded border border-ink-200 bg-white px-4 py-2 text-sm"
              >
                <p className="text-ink-900">{c.body}</p>
                <p className="mt-1 text-[11px] text-ink-500">
                  {c.authorKind === "admin" ? "Chef & Serve" : "Jij"} ·{" "}
                  {new Date(c.createdAt).toLocaleDateString("nl-NL", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function formatRange(start: Date | string, end: Date | string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })}, ${s.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}–${e.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
}

function PlacementPill({ status }: { status: string }) {
  const labels: Record<string, string> = {
    proposed: "Voorgesteld",
    accepted: "Toegezegd",
    confirmed: "Bevestigd",
    cancelled: "Geannuleerd",
    rejected: "Niet beschikbaar",
    no_show: "No-show",
    completed: "Afgerond",
  };
  const tone =
    status === "confirmed"
      ? "bg-emerald-100 text-emerald-700"
      : status === "accepted"
        ? "bg-blue-100 text-blue-700"
        : status === "proposed"
          ? "bg-amber-100 text-amber-800"
          : status === "completed"
            ? "bg-bg-gray text-ink-700"
            : "bg-bg-gray text-ink-500";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`}
    >
      {labels[status] ?? status}
    </span>
  );
}
