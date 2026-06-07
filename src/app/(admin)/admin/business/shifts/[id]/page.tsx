import { and, desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db/client";
import { assertImpersonationAllowed } from "@/lib/domain/impersonation";
import {
  recordAuditCore,
  recordAuditFromRequest,
  stampFromRequest,
} from "@/lib/audit";
import { withTx } from "@/lib/db/tx";
import {
  chefAvailability,
  chefs,
  clients,
  contactLogs,
  placements,
  shifts,
} from "@/lib/db/schema";
import { addPlacementComment, listVisibleComments } from "@/lib/domain/comments";
import { completePlacement } from "@/lib/domain/hours-admin";
import {
  findMatchesForShift,
  proposePlacement,
} from "@/lib/domain/matching";
import { getProfileCompleteness } from "@/lib/domain/profile-completeness";
import {
  estimateMargin,
  estimateTravel,
  type TransportMode,
} from "@/lib/domain/travel";
import {
  getRankScore,
  type CandidateSignals,
} from "@/lib/domain/staffing-intelligence";
import { amsterdamDayKey } from "@/lib/roster-format";
import { requirePermission } from "@/lib/permissions";
import { DetailShell } from "@/components/ui/DetailShell";
import { SummaryCard } from "./_components/SummaryCard";
import { NotesForm } from "./_components/NotesForm";
import { ExistingPlacements } from "./_components/ExistingPlacements";
import { MatchSuggestions } from "./_components/MatchSuggestions";
import { EmptyState } from "./_components/EmptyState";

export const metadata = { title: "Shift" };

export default async function ShiftDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("shifts", "write");
  const { id } = await params;

  const shift = await db.query.shifts.findFirst({
    where: eq(shifts.id, id),
    with: undefined,
  });
  if (!shift) notFound();

  const client = await db.query.clients.findFirst({
    where: eq(clients.id, shift.clientId),
  });

  const existingPlacements = await db
    .select({
      placement: placements,
      chef: chefs,
    })
    .from(placements)
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .where(eq(placements.shiftId, id))
    .orderBy(desc(placements.proposedAt));

  // Suggested chefs (skip if all placements confirmed for headcount)
  const confirmedCount = existingPlacements.filter(
    (p) => p.placement.status === "accepted" || p.placement.status === "confirmed",
  ).length;
  const matches =
    confirmedCount < shift.headcount
      ? await findMatchesForShift(id, { limit: 10 })
      : [];

  // PR-1.5 "Vul deze dienst" — enrich candidates with proof signals (current
  // data only: full chef row for rate/contact/completeness + worked-here count
  // for THIS client). Availability is deferred to PR-4, so it reads "onbekend".
  const candidateChefIds = matches.map((m) => m.chef.id);
  const candChefs = candidateChefIds.length
    ? await db.select().from(chefs).where(inArray(chefs.id, candidateChefIds))
    : [];
  const chefById = new Map(candChefs.map((c) => [c.id, c]));
  const workedHereRows = candidateChefIds.length
    ? await db
        .select({ chefId: placements.chefId, n: sql<number>`count(*)::int` })
        .from(placements)
        .innerJoin(shifts, eq(shifts.id, placements.shiftId))
        .where(
          and(
            inArray(placements.chefId, candidateChefIds),
            eq(shifts.clientId, shift.clientId),
            inArray(placements.status, ["confirmed", "completed"]),
          ),
        )
        .groupBy(placements.chefId)
    : [];
  const workedHereById = new Map(workedHereRows.map((r) => [r.chefId, r.n]));

  // PR-4: availability for THIS shift's Amsterdam day (no row = unknown).
  const shiftDayKey = amsterdamDayKey(shift.startsAt);
  const availRows = candidateChefIds.length
    ? await db
        .select({ chefId: chefAvailability.chefId, available: chefAvailability.available })
        .from(chefAvailability)
        .where(
          and(
            inArray(chefAvailability.chefId, candidateChefIds),
            sql`${chefAvailability.date}::date = ${shiftDayKey}::date`,
          ),
        )
    : [];
  const availabilityById = new Map(availRows.map((r) => [r.chefId, r.available]));
  // PR-2B: klant favorite/blocked sets.
  const favoriteSet = new Set(client?.favoriteChefIds ?? []);
  const blockedSet = new Set(client?.blockedChefIds ?? []);

  function candidateSignals(chefId: string, score: number): CandidateSignals {
    const c = chefById.get(chefId);
    const availability = availabilityById.has(chefId)
      ? availabilityById.get(chefId)
        ? "available"
        : "unavailable"
      : "unknown";
    return {
      matchScore: score,
      rateCents: c?.hourlyRateMinCents ?? null,
      workedHereCount: workedHereById.get(chefId) ?? 0,
      availability,
      isFavorite: favoriteSet.has(chefId),
      isBlocked: blockedSet.has(chefId),
      completeness: c
        ? getProfileCompleteness({
            vakniveau: c.vakniveau,
            city: c.city,
            segments: c.segments,
            yearsExperience: c.yearsExperience,
            hourlyRateMinCents: c.hourlyRateMinCents,
            hourlyRateMaxCents: c.hourlyRateMaxCents,
            email: c.email,
            phone: c.phone,
            specialties: c.specialties,
            languages: c.languages,
          })
        : null,
    };
  }

  // PR-3: travel + margin per candidate (shown when both ends are geocoded).
  const shiftCoords =
    shift.latitude != null && shift.longitude != null
      ? { lat: Number(shift.latitude), lng: Number(shift.longitude) }
      : null;
  const shiftHoursDuration =
    (new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime()) / 3_600_000;
  function travelFor(chefId: string) {
    const c = chefById.get(chefId);
    if (!shiftCoords || !c?.latitude || !c?.longitude) return null;
    const t = estimateTravel({
      from: { lat: Number(c.latitude), lng: Number(c.longitude) },
      to: shiftCoords,
      mode: (c.transportMode as TransportMode | null) ?? "none",
    });
    const margin = estimateMargin({
      clientRateCents: shift!.clientRateCents,
      chefRateCents: c.hourlyRateMinCents ?? shift!.chefRateCents,
      hours: shiftHoursDuration,
      travelCents: t.costCents,
    });
    return { t, margin };
  }

  // PR-3.1: full signal (incl. distance/margin) + rank. Blocked → bottom.
  function signalsFor(chefId: string, score: number): CandidateSignals {
    const base = candidateSignals(chefId, score);
    const tm = travelFor(chefId);
    return { ...base, distanceKm: tm?.t.km ?? null, marginTone: tm?.margin.tone ?? null };
  }
  const rankedMatches = [...matches].sort(
    (a, b) => getRankScore(signalsFor(b.chef.id, b.score)) - getRankScore(signalsFor(a.chef.id, a.score)),
  );
  // PR-5: top candidate's signals — drives the "waarom niet nr 1?" comparison.
  const topSignals = rankedMatches.length
    ? signalsFor(rankedMatches[0].chef.id, rankedMatches[0].score)
    : null;

  async function toggleClientChef(formData: FormData) {
    "use server";
    const session = await requirePermission("shifts", "write");
    const chefId = String(formData.get("chefId") ?? "");
    const kind = String(formData.get("kind") ?? "");
    const clientId = String(formData.get("clientId") ?? "");
    if (!chefId || !clientId) return;
    const [cl] = await db
      .select({ fav: clients.favoriteChefIds, blk: clients.blockedChefIds })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (!cl) return;
    const current = (kind === "blocked" ? cl.blk : cl.fav) ?? [];
    const turningOn = !current.includes(chefId);
    const next = turningOn
      ? [...current, chefId]
      : current.filter((x) => x !== chefId);
    await db
      .update(clients)
      .set(kind === "blocked" ? { blockedChefIds: next } : { favoriteChefIds: next })
      .where(eq(clients.id, clientId));
    await recordAuditFromRequest({
      userId: session.user.id,
      action: kind === "blocked" ? "clients.block_chef" : "clients.favorite_chef",
      resource: "clients",
      resourceId: clientId,
      after: { chefId, on: turningOn },
    });
    redirect(`/admin/business/shifts/${id}`);
  }

  async function logContact(formData: FormData) {
    "use server";
    const session = await requirePermission("shifts", "write");
    const chefId = String(formData.get("chefId") ?? "").trim();
    if (!chefId) return;
    const outcome = String(formData.get("outcome") ?? "note_only");
    const note = String(formData.get("note") ?? "").trim() || null;
    await db.insert(contactLogs).values({
      actorUserId: session.user.id,
      targetType: "chef",
      targetId: chefId,
      channel: "phone",
      entityType: "shift",
      entityId: id,
      outcome,
      note,
    });
    await recordAuditFromRequest({
      userId: session.user.id,
      action: "contact_logs.created",
      resource: "contact_logs",
      resourceId: chefId,
      after: { shiftId: id, outcome },
    });
    redirect(`/admin/business/shifts/${id}`);
  }

  async function propose(formData: FormData) {
    "use server";
    const session = await requirePermission("shifts", "write");
    const chefId = String(formData.get("chefId") ?? "").trim();
    const matchScore = formData.get("matchScore")
      ? Number(formData.get("matchScore"))
      : undefined;
    if (!chefId) throw new Error("chefId missing");

    const { placementId } = await proposePlacement(id, chefId, {
      proposedBy: session.user.id,
      matchScore,
    });

    await recordAuditFromRequest({
      userId: session.user.id,
      action: "placements.propose",
      resource: "placements",
      resourceId: placementId,
      after: { shiftId: id, chefId, matchScore },
    });

    redirect(`/admin/business/shifts/${id}`);
  }

  async function setPlacementStatus(formData: FormData) {
    "use server";
    const session = await requirePermission("shifts", "write");
    const placementId = String(formData.get("placementId") ?? "").trim();
    const newStatus = String(formData.get("newStatus") ?? "") as
      | "accepted"
      | "confirmed"
      | "rejected"
      | "cancelled";

    // Irreversible cancellation is destructive — blocked during "Bekijk als".
    if (newStatus === "cancelled") {
      await assertImpersonationAllowed();
    }

    const setMap: Record<string, Date> = {
      accepted: new Date(),
      confirmed: new Date(),
      rejected: new Date(),
      cancelled: new Date(),
    };

    const auditBase = await stampFromRequest({
      userId: session.user.id,
      action: `placements.${newStatus}`,
      resource: "placements",
      resourceId: placementId,
    });
    // Atomic: status transition + audit (email + redirect stay post-commit).
    // PR-AUDIT-8: guard the transition — never resurrect a terminal placement
    // (completed/cancelled). 0 rows updated → stale form or double-submit; bail
    // before the audit + confirmation email fire.
    let changed = false;
    await withTx(async (tx) => {
      const updated = await tx
        .update(placements)
        .set({
          status: newStatus,
          respondedAt: ["accepted", "rejected"].includes(newStatus)
            ? setMap[newStatus]
            : undefined,
          confirmedAt: newStatus === "confirmed" ? setMap[newStatus] : undefined,
          cancelledAt: newStatus === "cancelled" ? setMap[newStatus] : undefined,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(placements.id, placementId),
            sql`${placements.status} NOT IN ('completed', 'cancelled')`,
          ),
        )
        .returning({ id: placements.id });
      if (updated.length === 0) return; // terminal/stale — no-op
      changed = true;
      await recordAuditCore(auditBase, tx);
    });
    if (!changed) {
      redirect(`/admin/business/shifts/${id}?err=placement-terminal`);
    }

    // Send client-confirmation email when a placement reaches "confirmed"
    if (newStatus === "confirmed") {
      try {
        const placement = await db.query.placements.findFirst({
          where: eq(placements.id, placementId),
        });
        if (placement) {
          const chef = await db.query.chefs.findFirst({
            where: eq(chefs.id, placement.chefId),
          });
          const shift = await db.query.shifts.findFirst({
            where: eq(shifts.id, placement.shiftId),
          });
          const clientRow = shift
            ? await db.query.clients.findFirst({
                where: eq(clients.id, shift.clientId),
              })
            : null;
          if (chef && shift) {
            const { sendEmail, formatShiftWhen } = await import("@/lib/email");
            const { recordEmailMessage, createNotification } = await import(
              "@/lib/integrations"
            );
            const { ShiftConfirmedClientEmail } = await import(
              "@/emails/ShiftConfirmedClientEmail"
            );
            const { ShiftConfirmedChefEmail } = await import(
              "@/emails/ShiftConfirmedChefEmail"
            );
            const shiftWhen = formatShiftWhen(shift.startsAt, shift.endsAt);

            // KLANT email — PR-AUDIT-2: route via recipientsForClient (single
            // seam + billing/contact routing). Operational confirmation that
            // the klant can't opt out of → "generic" (always sends).
            if (clientRow) {
              const { recipientsForClient } = await import(
                "@/lib/domain/client-recipients"
              );
              const klantTo = await recipientsForClient(clientRow.id, "generic");
              if (klantTo.length > 0) {
                const send = await sendEmail({
                  to: klantTo,
                  subject: `Chef bevestigd voor ${clientRow.companyName} — ${shift.roleNeeded}`,
                  react: ShiftConfirmedClientEmail({
                    clientContactName: clientRow.contactName,
                    companyName: clientRow.companyName,
                    chefName: chef.fullName,
                    chefVakniveau: chef.vakniveau,
                    chefYears: chef.yearsExperience,
                    shiftWhen,
                    shiftLocation: shift.location ?? shift.city,
                    shiftRole: shift.roleNeeded,
                  }),
                });
                if (send.ok) {
                  for (const to of klantTo) {
                    await recordEmailMessage({
                      providerMessageId: send.id,
                      toEmail: to,
                      template: "ShiftConfirmedClientEmail",
                      eventKey: "shift_confirmed",
                      entityType: "placement",
                      entityId: placementId,
                      userId: clientRow.userId ?? undefined,
                    });
                  }
                }
              }
            }

            // CHEF email (PR-CHEF-5 new — chef closes the loop too)
            if (chef.email) {
              const send = await sendEmail({
                to: chef.email,
                subject: `Shift bevestigd: ${shift.roleNeeded} bij ${clientRow?.companyName ?? "klant"}`,
                react: ShiftConfirmedChefEmail({
                  chefName: chef.fullName,
                  clientName: clientRow?.companyName ?? "—",
                  shiftWhen,
                  shiftLocation: shift.location ?? shift.city,
                  shiftRole: shift.roleNeeded,
                  clientContactName: clientRow?.contactName,
                  clientContactPhone: clientRow?.phone,
                }),
              });
              if (send.ok) {
                await recordEmailMessage({
                  providerMessageId: send.id,
                  toEmail: chef.email,
                  template: "ShiftConfirmedChefEmail",
                  eventKey: "shift_confirmed",
                  entityType: "placement",
                  entityId: placementId,
                  userId: chef.userId ?? undefined,
                });
              }
            }

            // In-app notification for the chef
            if (chef.userId) {
              await createNotification({
                userId: chef.userId,
                type: "shift_confirmed",
                title: `Shift bevestigd bij ${clientRow?.companyName ?? "klant"}`,
                body: shiftWhen,
                actionUrl: `/chef/shifts/${placementId}`,
                entityType: "placement",
                entityId: placementId,
              });
            }
          }
        }
      } catch (e) {
        console.error("[confirmed] notification failed:", e);
      }
    }

    redirect(`/admin/business/shifts/${id}`);
  }

  // Hours-ops: force-complete a CONFIRMED placement on demand (instead of
  // waiting for the complete-placements cron). Mints the draft shift_hours row
  // and jumps straight to it so the admin can keep the loop moving.
  async function completePlacementAction(formData: FormData) {
    "use server";
    const session = await requirePermission("shifts", "write");
    const placementId = String(formData.get("placementId") ?? "").trim();
    if (!placementId) return;

    const result = await completePlacement({
      placementId,
      actorUserId: session.user.id,
    });

    if (!result.ok) {
      redirect(`/admin/business/shifts/${id}?err=${result.reason}`);
    }
    if (result.hoursId) {
      redirect(`/admin/business/hours/${result.hoursId}`);
    }
    redirect(`/admin/business/shifts/${id}?ok=completed`);
  }

  // PR-KLANT-3: admin replies to / posts placement comments.
  async function replyComment(formData: FormData) {
    "use server";
    const session = await requirePermission("shifts", "write");
    const placementId = String(formData.get("placementId") ?? "");
    const body = String(formData.get("body") ?? "");
    const visibility =
      String(formData.get("visibility") ?? "client_visible") === "internal"
        ? "internal"
        : String(formData.get("visibility")) === "chef_visible"
          ? "chef_visible"
          : "client_visible";
    if (!placementId) redirect(`/admin/business/shifts/${id}`);
    await addPlacementComment({
      placementId,
      authorUserId: session.user.id,
      authorKind: "admin",
      visibility,
      body,
    });
    redirect(`/admin/business/shifts/${id}`);
  }

  // Admin sees ALL comments (every visibility) per placement.
  const commentsByPlacement = new Map(
    await Promise.all(
      existingPlacements.map(
        async ({ placement }) =>
          [
            placement.id,
            await listVisibleComments(placement.id, { kind: "admin" }),
          ] as const,
      ),
    ),
  );

  async function updateShiftNotes(formData: FormData) {
    "use server";
    const s = await requirePermission("shifts", "write");
    const sid = String(formData.get("shiftId") ?? "").trim();
    if (!sid) return;
    const notes = String(formData.get("notes") ?? "").trim() || null;
    const chefVisibleNotes =
      String(formData.get("chefVisibleNotes") ?? "").trim() || null;
    const clientVisibleNotes =
      String(formData.get("clientVisibleNotes") ?? "").trim() || null;
    const auditBase = await stampFromRequest({
      userId: s.user.id,
      action: "shifts.update_notes",
      resource: "shifts",
      resourceId: sid,
      after: {
        hasChefNote: Boolean(chefVisibleNotes),
        hasClientNote: Boolean(clientVisibleNotes),
      },
    });
    await withTx(async (tx) => {
      await tx
        .update(shifts)
        .set({ notes, chefVisibleNotes, clientVisibleNotes, updatedAt: new Date() })
        .where(eq(shifts.id, sid));
      await recordAuditCore(auditBase, tx);
    });
    revalidatePath(`/admin/business/shifts/${sid}`);
  }

  return (
    <DetailShell
      className="mx-auto max-w-5xl"
      backHref="/admin/business/shifts"
      backLabel="Shifts"
      eyebrow="Shift"
      title={
        <>
          {shift.roleNeeded}
          {shift.segment && (
            <span className="ml-2 text-ink-500">· {shift.segment}</span>
          )}
        </>
      }
      actions={<StatusBadge status={shift.status} />}
    >
      <p className="mt-2 text-sm text-ink-700">
        <Link
          href={`/admin/business/clients/${shift.clientId}`}
          className="text-burgundy underline-offset-4 hover:underline"
        >
          {client?.companyName ?? "(klant verwijderd)"}
        </Link>
        {" · "}
        {formatDateRange(shift.startsAt, shift.endsAt)}
        {shift.city && ` · ${shift.city}`}
      </p>

      {/* Summary card */}
      <SummaryCard shift={shift} confirmedCount={confirmedCount} />

      {/* PR-CHEF-2b — three note channels with explicit visibility. */}
      <NotesForm updateShiftNotes={updateShiftNotes} shift={shift} />

      {/* Existing placements */}
      {existingPlacements.length > 0 && (
        <ExistingPlacements
          existingPlacements={existingPlacements}
          commentsByPlacement={commentsByPlacement}
          setPlacementStatus={setPlacementStatus}
          replyComment={replyComment}
          completePlacementAction={completePlacementAction}
        />
      )}

      {/* Match suggestions */}
      {matches.length > 0 && (
        <MatchSuggestions
          matches={matches}
          rankedMatches={rankedMatches}
          chefById={chefById}
          signalsFor={signalsFor}
          travelFor={travelFor}
          topSignals={topSignals}
          shift={shift}
          propose={propose}
          logContact={logContact}
          toggleClientChef={toggleClientChef}
        />
      )}

      {matches.length === 0 && existingPlacements.length === 0 && <EmptyState />}
    </DetailShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "open"
      ? "bg-amber-100 text-amber-700"
      : status === "filled"
        ? "bg-emerald-100 text-emerald-700"
        : status === "completed"
          ? "bg-blue-100 text-blue-700"
          : status === "cancelled"
            ? "bg-red-100 text-red-700"
            : "bg-bg-gray text-ink-500";
  return (
    <span
      className={`rounded-full px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-wider ${tone}`}
    >
      {status}
    </span>
  );
}

function formatDateRange(start: Date, end: Date): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })}, ${s.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}–${e.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
}
