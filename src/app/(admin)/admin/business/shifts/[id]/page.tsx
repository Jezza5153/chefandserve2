import { and, desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

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
import {
  findMatchesForShift,
  proposePlacement,
} from "@/lib/domain/matching";
import { getProfileCompleteness } from "@/lib/domain/profile-completeness";
import {
  estimateMargin,
  estimateTravel,
  eur,
  type TransportMode,
} from "@/lib/domain/travel";
import {
  getChefCandidateBadges,
  getChefMatchExplanation,
  getMatchConfidenceLabel,
  getRankGapReasons,
  getRankScore,
  type CandidateSignals,
} from "@/lib/domain/staffing-intelligence";
import { amsterdamDayKey } from "@/lib/roster-format";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Shift" };

export default async function ShiftDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("owner");
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
    const session = await requireRole("owner");
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
    const session = await requireRole("owner");
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
    const session = await requireRole("owner");
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
    const session = await requireRole("owner");
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
    await withTx(async (tx) => {
      await tx
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
        .where(eq(placements.id, placementId));
      await recordAuditCore(auditBase, tx);
    });

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

            // KLANT email (existing behavior)
            if (clientRow?.email) {
              const send = await sendEmail({
                to: clientRow.email,
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
                await recordEmailMessage({
                  providerMessageId: send.id,
                  toEmail: clientRow.email,
                  template: "ShiftConfirmedClientEmail",
                  eventKey: "shift_confirmed",
                  entityType: "placement",
                  entityId: placementId,
                  userId: clientRow.userId ?? undefined,
                });
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

  // PR-KLANT-3: admin replies to / posts placement comments.
  async function replyComment(formData: FormData) {
    "use server";
    const session = await requireRole("owner");
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

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <Link
          href="/admin/business/shifts"
          className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          ← Shifts
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Shift
          </p>
          <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
            {shift.roleNeeded}
            {shift.segment && (
              <span className="ml-2 text-ink-500">· {shift.segment}</span>
            )}
          </h1>
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
        </div>
        <StatusBadge status={shift.status} />
      </div>

      {/* Summary card */}
      <div className="mt-8 grid gap-4 rounded-lg border border-ink-200 bg-white p-6 md:grid-cols-3">
        <SummaryCell label="Aantal nodig" value={shift.headcount.toString()} />
        <SummaryCell
          label="Bevestigd"
          value={`${confirmedCount} / ${shift.headcount}`}
          highlight={confirmedCount >= shift.headcount}
        />
        <SummaryCell
          label="Tarief klant"
          value={shift.clientRateCents ? `€${(shift.clientRateCents / 100).toFixed(2)}/u` : "—"}
        />
        <SummaryCell
          label="Tarief chef"
          value={shift.chefRateCents ? `€${(shift.chefRateCents / 100).toFixed(2)}/u` : "—"}
        />
        <SummaryCell label="Locatie" value={shift.location ?? "—"} />
        <SummaryCell label="Notities" value={shift.notes ?? "—"} />
      </div>

      {/* Existing placements */}
      {existingPlacements.length > 0 && (
        <section className="mt-10">
          <h2 className="font-serif text-xl text-ink-900">
            Voorgestelde chefs ({existingPlacements.length})
          </h2>
          <ul className="mt-4 space-y-2">
            {existingPlacements.map(({ placement, chef }) => (
              <li
                key={placement.id}
                className="rounded-lg border border-ink-200 bg-white p-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/business/chefs/${chef.id}`}
                      className="font-serif text-base text-ink-900 hover:text-burgundy hover:underline"
                    >
                      {chef.fullName}
                    </Link>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {chef.vakniveau ?? "—"} · {chef.city ?? "—"}
                      {placement.matchScore && ` · match-score: ${placement.matchScore}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <PlacementStatusBadge status={placement.status} />
                    {placement.status === "proposed" && (
                      <>
                        <PlacementAction
                          action={setPlacementStatus}
                          placementId={placement.id}
                          newStatus="accepted"
                          label="✓ Accepteer"
                          tone="green"
                        />
                        <PlacementAction
                          action={setPlacementStatus}
                          placementId={placement.id}
                          newStatus="rejected"
                          label="✗ Wijs af"
                          tone="red"
                        />
                      </>
                    )}
                    {placement.status === "accepted" && (
                      <PlacementAction
                        action={setPlacementStatus}
                        placementId={placement.id}
                        newStatus="confirmed"
                        label="Bevestig"
                        tone="green"
                      />
                    )}
                  </div>
                </div>

                {/* PR-KLANT-3: comment thread (all visibilities) + reply */}
                <div className="mt-3 border-t border-ink-100 pt-3">
                  <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
                    Berichten
                  </p>
                  {(commentsByPlacement.get(placement.id) ?? []).length > 0 ? (
                    <ul className="mt-2 space-y-1.5">
                      {(commentsByPlacement.get(placement.id) ?? []).map((c) => (
                        <li key={c.id} className="text-sm">
                          <span className="text-ink-900">{c.body}</span>
                          <span className="ml-2 text-[11px] text-ink-500">
                            {c.authorKind === "client"
                              ? "Klant"
                              : c.authorKind === "chef"
                                ? "Chef"
                                : c.authorKind === "admin"
                                  ? "Chef & Serve"
                                  : "Systeem"}{" "}
                            · <CommentVisibilityTag visibility={c.visibility} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-ink-500">Nog geen berichten.</p>
                  )}

                  <form action={replyComment} className="mt-2">
                    <input type="hidden" name="placementId" value={placement.id} />
                    <textarea
                      name="body"
                      rows={2}
                      required
                      maxLength={1000}
                      placeholder="Reageer op de klant / chef…"
                      className="w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <select
                        name="visibility"
                        defaultValue="client_visible"
                        className="rounded border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-900 focus:border-burgundy focus:outline-none"
                      >
                        <option value="client_visible">Zichtbaar voor klant</option>
                        <option value="chef_visible">Zichtbaar voor chef</option>
                        <option value="internal">Interne notitie</option>
                      </select>
                      <button
                        type="submit"
                        className="rounded-full bg-burgundy px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900"
                      >
                        Plaats bericht
                      </button>
                    </div>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Match suggestions */}
      {matches.length > 0 && (
        <section className="mt-10">
          <h2 className="font-serif text-xl text-ink-900">
            Vul deze dienst — beste matches (top {matches.length})
          </h2>
          <p className="mt-2 text-sm text-ink-700">
            Gerankt op match × beschikbaarheid × afstand × marge × historie ·
            klant-favorieten boven, geblokkeerde chefs onderaan. Bestaande
            voorstellen zijn uitgesloten.
          </p>
          <ul className="mt-4 space-y-2">
            {rankedMatches.map((m, idx) => {
              const c = chefById.get(m.chef.id);
              const sig = signalsFor(m.chef.id, m.score);
              const conf = getMatchConfidenceLabel(sig);
              const expl = getChefMatchExplanation(sig);
              const badges = getChefCandidateBadges(sig);
              const allWarnings = [...new Set([...m.warnings, ...expl.warnings])];
              const gapReasons =
                idx > 0 && topSignals && !sig.isBlocked
                  ? getRankGapReasons(topSignals, sig)
                  : [];
              const phoneDigits = c?.phone?.replace(/\D/g, "") ?? "";
              const tm = travelFor(m.chef.id);
              return (
                <li
                  key={m.chef.id}
                  className={`rounded-lg border bg-white p-4 ${
                    sig.isBlocked ? "border-red-300 bg-red-50/40" : "border-ink-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/admin/business/chefs/${m.chef.id}`}
                          className="font-serif text-base text-ink-900 hover:text-burgundy hover:underline"
                        >
                          {m.chef.fullName}
                        </Link>
                        <span className={`rounded-full px-2 py-0.5 font-ui text-[10px] font-medium uppercase tracking-wider ${scoreTone(m.score)}`}>
                          {m.score}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 font-ui text-[10px] font-medium uppercase tracking-wider ${confTone(conf.label)}`}>
                          {conf.label}
                          {conf.reason ? ` · ${conf.reason}` : ""}
                        </span>
                        {sig.isFavorite && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-ui text-[10px] font-medium uppercase tracking-wider text-emerald-700">
                            ★ favoriet
                          </span>
                        )}
                        {sig.isBlocked && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 font-ui text-[10px] font-medium uppercase tracking-wider text-red-700">
                            ⊘ geblokkeerd
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-ink-500">
                        {m.chef.vakniveau ?? "—"} · {m.chef.city ?? "—"}
                        {m.chef.yearsExperience ? ` · ${m.chef.yearsExperience}j ervaring` : ""}
                      </p>
                      {badges.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {badges.map((b, i) => (
                            <span key={i} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badgeTone(b.tone)}`}>
                              {b.label}
                            </span>
                          ))}
                        </div>
                      )}
                      {tm && (
                        <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                            ≈ {eur(tm.t.costCents)} reis · {tm.t.km} km · {tm.t.basis}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 font-medium ${
                              tm.margin.tone === "negative"
                                ? "bg-red-100 text-red-700"
                                : tm.margin.tone === "low"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            marge {eur(tm.margin.marginCents)}
                            {tm.margin.tone === "low" ? " (laag)" : tm.margin.tone === "negative" ? " (negatief)" : ""}
                          </span>
                        </div>
                      )}
                      {m.reasons.length > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-1">
                          {m.reasons.map((r) => (
                            <li key={r} className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">✓ {r}</li>
                          ))}
                        </ul>
                      )}
                      {allWarnings.length > 0 && (
                        <ul className="mt-1 flex flex-wrap gap-1">
                          {allWarnings.map((w) => (
                            <li key={w} className="rounded bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">⚠ {w}</li>
                          ))}
                        </ul>
                      )}
                      {expl.nextCheck.length > 0 && (
                        <p className="mt-1.5 text-[11px] text-ink-500">
                          <span className="font-medium text-ink-700">Checken:</span>{" "}
                          {expl.nextCheck.join(" · ")}
                        </p>
                      )}
                      {gapReasons.length > 0 && (
                        <p className="mt-1 text-[11px] text-ink-500">
                          <span className="font-medium text-ink-700">Waarom niet nr 1:</span>{" "}
                          {gapReasons.join(" · ")}
                        </p>
                      )}
                    </div>
                    <form action={propose}>
                      <input type="hidden" name="chefId" value={m.chef.id} />
                      <input type="hidden" name="matchScore" value={m.score} />
                      <button type="submit" className="shrink-0 rounded-full bg-burgundy px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900">
                        Voorstel
                      </button>
                    </form>
                  </div>
                  {/* Contact actions (one-click + log) */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
                    {phoneDigits && (
                      <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noopener noreferrer" className="rounded-full border border-ink-200 bg-white px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-700 hover:border-burgundy hover:text-burgundy">
                        App
                      </a>
                    )}
                    {c?.email && (
                      <a href={`mailto:${c.email}`} className="rounded-full border border-ink-200 bg-white px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-700 hover:border-burgundy hover:text-burgundy">
                        Mail
                      </a>
                    )}
                    <form action={logContact} className="flex items-center gap-1.5">
                      <input type="hidden" name="chefId" value={m.chef.id} />
                      <select name="outcome" className="rounded border border-ink-200 bg-white px-2 py-1 text-[11px] text-ink-700">
                        <option value="spoken">Gesproken</option>
                        <option value="no_answer">Geen gehoor</option>
                        <option value="callback_requested">Teruggebeld</option>
                        <option value="not_suitable">Niet passend</option>
                        <option value="note_only">Notitie</option>
                      </select>
                      <input name="note" placeholder="notitie" className="w-28 rounded border border-ink-200 bg-white px-2 py-1 text-[11px] text-ink-700" />
                      <button type="submit" className="rounded-full border border-burgundy/40 bg-white px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5">
                        Log
                      </button>
                    </form>
                    {/* PR-2B: klant-favoriet / blokkeer toggle */}
                    <div className="ml-auto flex items-center gap-1.5">
                      <form action={toggleClientChef}>
                        <input type="hidden" name="chefId" value={m.chef.id} />
                        <input type="hidden" name="clientId" value={shift.clientId} />
                        <input type="hidden" name="kind" value="favorite" />
                        <button
                          type="submit"
                          className={`rounded-full border px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] ${
                            sig.isFavorite
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                              : "border-ink-200 bg-white text-ink-700 hover:border-emerald-300 hover:text-emerald-700"
                          }`}
                        >
                          {sig.isFavorite ? "★ favoriet" : "☆ favoriet"}
                        </button>
                      </form>
                      <form action={toggleClientChef}>
                        <input type="hidden" name="chefId" value={m.chef.id} />
                        <input type="hidden" name="clientId" value={shift.clientId} />
                        <input type="hidden" name="kind" value="blocked" />
                        <button
                          type="submit"
                          className={`rounded-full border px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] ${
                            sig.isBlocked
                              ? "border-red-300 bg-red-50 text-red-700"
                              : "border-ink-200 bg-white text-ink-700 hover:border-red-300 hover:text-red-700"
                          }`}
                        >
                          {sig.isBlocked ? "⊘ geblokkeerd" : "⊘ blokkeer"}
                        </button>
                      </form>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {matches.length === 0 && existingPlacements.length === 0 && (
        <div className="mt-10 rounded-lg border border-ink-200 bg-white p-10 text-center">
          <p className="font-serif text-xl text-ink-900">
            Geen geschikte chefs gevonden
          </p>
          <p className="mt-2 text-sm text-ink-500">
            Voeg meer chefs toe of pas de shift-criteria aan.
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
        {label}
      </p>
      <p
        className={`mt-1 font-serif text-base ${
          highlight ? "text-emerald-700" : "text-ink-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function PlacementAction({
  action,
  placementId,
  newStatus,
  label,
  tone,
}: {
  action: (formData: FormData) => Promise<void>;
  placementId: string;
  newStatus: string;
  label: string;
  tone: "green" | "red";
}) {
  const c =
    tone === "green"
      ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
      : "border-red-300 text-red-700 hover:bg-red-50";
  return (
    <form action={action}>
      <input type="hidden" name="placementId" value={placementId} />
      <input type="hidden" name="newStatus" value={newStatus} />
      <button
        type="submit"
        className={`rounded-full border px-3 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] ${c}`}
      >
        {label}
      </button>
    </form>
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

function PlacementStatusBadge({ status }: { status: string }) {
  const tone =
    status === "confirmed"
      ? "bg-emerald-100 text-emerald-700"
      : status === "accepted"
        ? "bg-blue-100 text-blue-700"
        : status === "proposed"
          ? "bg-amber-100 text-amber-700"
          : status === "rejected" || status === "cancelled" || status === "no_show"
            ? "bg-red-100 text-red-700"
            : "bg-bg-gray text-ink-500";
  return (
    <span
      className={`rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`}
    >
      {status}
    </span>
  );
}

function scoreTone(score: number): string {
  if (score >= 80) return "bg-emerald-100 text-emerald-700";
  if (score >= 60) return "bg-blue-100 text-blue-700";
  if (score >= 40) return "bg-amber-100 text-amber-700";
  return "bg-bg-gray text-ink-500";
}

function confTone(label: "hoog" | "midden" | "laag"): string {
  if (label === "hoog") return "bg-emerald-100 text-emerald-700";
  if (label === "midden") return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-700";
}

function badgeTone(tone: "green" | "amber" | "blue" | "grey" | "red"): string {
  const map = {
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-800",
    blue: "bg-blue-100 text-blue-700",
    grey: "bg-bg-gray text-ink-600",
    red: "bg-red-100 text-red-700",
  } as const;
  return map[tone];
}

function CommentVisibilityTag({ visibility }: { visibility: string }) {
  const label =
    visibility === "client_visible"
      ? "klant ziet dit"
      : visibility === "chef_visible"
        ? "chef ziet dit"
        : "intern";
  return <span className="italic">{label}</span>;
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
