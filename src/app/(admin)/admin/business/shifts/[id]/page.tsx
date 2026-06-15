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
  matchIntel,
  placements,
  shifts,
} from "@/lib/db/schema";
import { addPlacementComment, listVisibleComments } from "@/lib/domain/comments";
import { listInterestedChefs } from "@/lib/domain/shift-interests";
import { saveMatchIntel } from "@/lib/domain/intel";
import { completePlacement } from "@/lib/domain/hours-admin";
import {
  findMatchesForShift,
  proposePlacement,
} from "@/lib/domain/matching";
import { assertChefsDeployable } from "@/lib/domain/chef-deployability-gate";
import { env } from "@/lib/env";
import {
  cancelShiftAndPlacements,
  recomputeShiftStatus,
} from "@/lib/domain/shift-status";
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
import { MatchSuggestions, type PairIntelBadge } from "./_components/MatchSuggestions";
import { EmptyState } from "./_components/EmptyState";
import { MatchIntelSection, type PairValue } from "./_components/MatchIntelSection";

export const metadata = { title: "Shift" };

export default async function ShiftDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ info?: string; ok?: string; err?: string }>;
}) {
  await requirePermission("shifts", "write");
  const { id } = await params;
  const sp = await searchParams;
  const flash =
    sp.info === "al-voorgesteld"
      ? { tone: "info" as const, text: "Deze chef is al voorgesteld voor deze dienst." }
      : sp.ok === "cancelled"
        ? { tone: "ok" as const, text: "Dienst geannuleerd. Bevestigde chefs zijn op de hoogte gebracht." }
        : sp.err === "already-cancelled"
          ? { tone: "err" as const, text: "Deze dienst was al geannuleerd." }
          : null;

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

  // CHEF-OPEN: chefs who raised their hand via "Open diensten" (express-interest).
  const interestedChefs = await listInterestedChefs(id);

  // PR-1.5 "Vul deze dienst" — enrich candidates with proof signals (current
  // data only: full chef row for rate/contact/completeness + worked-here count
  // for THIS client). Availability is deferred to PR-4, so it reads "onbekend".
  const candidateChefIds = matches.map((m) => m.chef.id);
  const candChefs = candidateChefIds.length
    ? await db.select().from(chefs).where(inArray(chefs.id, candidateChefIds))
    : [];
  const chefById = new Map(candChefs.map((c) => [c.id, c]));
  // P3a compliance hard-gate (flag-gated): per-candidate deployability for the override
  // panel. Off → empty Map → MatchSuggestions renders the normal one-click propose.
  const deployByChef =
    env.COMPLIANCE_HARDGATE_ENABLED === "true" && candidateChefIds.length
      ? await assertChefsDeployable(candidateChefIds)
      : undefined;
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

  // PR-INTEL-P6: captured pair-memory + post-shift thumbs for each candidate at
  // THIS klant — surfaced in the rail so the data Maarten/chefs captured drives
  // the choice. Two batched queries (note/wouldRehire + thumb tallies).
  const pairIntelByChef = new Map<string, PairIntelBadge>();
  if (candidateChefIds.length > 0) {
    const [pairRows, thumbRows] = await Promise.all([
      db
        .select({
          chefId: matchIntel.chefId,
          note: matchIntel.note,
          wouldRehire: matchIntel.wouldRehire,
        })
        .from(matchIntel)
        .where(
          and(
            eq(matchIntel.clientId, shift.clientId),
            inArray(matchIntel.chefId, candidateChefIds),
          ),
        ),
      db
        .select({
          chefId: placements.chefId,
          up: sql<number>`coalesce(count(*) filter (where ${placements.chefReturnSignal} = true),0)::int`,
          down: sql<number>`coalesce(count(*) filter (where ${placements.chefReturnSignal} = false),0)::int`,
        })
        .from(placements)
        .innerJoin(shifts, eq(shifts.id, placements.shiftId))
        .where(
          and(
            inArray(placements.chefId, candidateChefIds),
            eq(shifts.clientId, shift.clientId),
          ),
        )
        .groupBy(placements.chefId),
    ]);
    for (const cid of candidateChefIds) {
      pairIntelByChef.set(cid, { note: null, wouldRehire: null, up: 0, down: 0 });
    }
    for (const r of pairRows) {
      const e = pairIntelByChef.get(r.chefId);
      if (e) {
        e.note = r.note;
        e.wouldRehire = r.wouldRehire;
      }
    }
    for (const r of thumbRows) {
      const e = pairIntelByChef.get(r.chefId);
      if (e) {
        e.up = Number(r.up);
        e.down = Number(r.down);
      }
    }
  }

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

    // P3a compliance override (auth-resolved actor, never form data); absent → block.
    const overrideReason = String(formData.get("overrideReason") ?? "").trim();
    const override = overrideReason ? { overriddenBy: session.user.id, reason: overrideReason } : undefined;

    const res = await proposePlacement(id, chefId, {
      proposedBy: session.user.id,
      matchScore,
      override,
    });

    // P3a: blocked chef + no valid override → flash so the override panel re-renders.
    if (res.status === "blocked") {
      redirect(`/admin/business/shifts/${id}?info=geblokkeerd`);
    }
    const { placementId, status } = res;

    // Already-active placement → friendly notice, no second audit/notify.
    if (status === "already_proposed") {
      redirect(`/admin/business/shifts/${id}?info=al-voorgesteld`);
    }

    await recordAuditFromRequest({
      userId: session.user.id,
      action: "placements.propose",
      resource: "placements",
      resourceId: placementId,
      after: { shiftId: id, chefId, matchScore },
    });

    // Keep the shift status aligned (request → open, or → filled if this was a
    // re-propose of an already-confirmed-elsewhere chef count).
    await recomputeShiftStatus(id);

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
      // Backbone follows the placements: advance the shift to filled/open in the
      // SAME tx so its status never drifts from reality.
      await recomputeShiftStatus(id, tx);
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

            // KLANT email — route via recipientsForClient (single seam +
            // billing/contact routing) on the dedicated "shift_confirmed" event
            // (klant-mutable, role-routed). Mirrors sendPlacementConfirmedEmails.
            if (clientRow) {
              const { recipientsForClient } = await import(
                "@/lib/domain/client-recipients"
              );
              const klantTo = await recipientsForClient(clientRow.id, "shift_confirmed");
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
                    hubUrl: `${process.env.NEXT_PUBLIC_APP_URL}/client/shifts/${shift.id}`,
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
              // Klant in-app note — every user-visible event → createNotification()
              // (was missing; only the chef got one). Always fires (bell = floor).
              if (clientRow.userId) {
                await createNotification({
                  userId: clientRow.userId,
                  type: "shift_confirmed",
                  title: `Chef bevestigd voor ${shift.roleNeeded}`,
                  body: `${chef.fullName} is bevestigd voor je shift.`,
                  actionUrl: `/client/shifts/${shift.id}`,
                  entityType: "placement",
                  entityId: placementId,
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
                  placementUrl: `${process.env.NEXT_PUBLIC_APP_URL}/chef/shifts/${placementId}`,
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
    // The placement is now completed — let the shift follow (→ completed once it
    // has ended and every non-cancelled placement is done).
    await recomputeShiftStatus(id);
    if (result.hoursId) {
      redirect(`/admin/business/hours/${result.hoursId}`);
    }
    redirect(`/admin/business/shifts/${id}?ok=completed`);
  }

  // P3: admin cancels the whole dienst. Atomic: shift → cancelled, every
  // non-terminal placement (proposed/accepted/confirmed) → cancelled, audit.
  // Confirmed chefs were committed, so they're notified after commit. Blocked
  // during "Bekijk als" (destructive).
  async function cancelShift(formData: FormData) {
    "use server";
    const session = await requirePermission("shifts", "write");
    await assertImpersonationAllowed();
    const sid = String(formData.get("shiftId") ?? "").trim();
    if (sid !== id) return;
    const reason = String(formData.get("reason") ?? "").trim() || null;

    const auditBase = await stampFromRequest({
      userId: session.user.id,
      action: "shifts.cancelled",
      resource: "shifts",
      resourceId: id,
      after: { reason },
    });

    // Atomic transition: shift → cancelled (guarded against double-cancel) +
    // every still-live placement → cancelled + audit, all-or-nothing. Shares
    // the cancel logic with the approve-a-cancel-request path.
    const cancelled = await withTx(async (tx) => {
      const { changed } = await cancelShiftAndPlacements(id, reason, tx);
      if (!changed) return false;
      await recordAuditCore(auditBase, tx);
      return true;
    });

    if (!cancelled) {
      redirect(`/admin/business/shifts/${id}?err=already-cancelled`);
    }

    // Notify the chefs who were CONFIRMED (committed) — they're the ones who
    // need telling. Only confirmed placements ever get `confirmedAt` set, so
    // that's a reliable post-commit filter for the now-cancelled rows.
    try {
      // Self-contained read (incl. shift + klant fields) so we don't rely on
      // outer-scope narrowing inside this server-action closure.
      const affected = await db
        .select({
          chefName: chefs.fullName,
          chefEmail: chefs.email,
          chefUserId: chefs.userId,
          startsAt: shifts.startsAt,
          endsAt: shifts.endsAt,
          roleNeeded: shifts.roleNeeded,
          companyName: clients.companyName,
        })
        .from(placements)
        .innerJoin(chefs, eq(chefs.id, placements.chefId))
        .innerJoin(shifts, eq(shifts.id, placements.shiftId))
        .leftJoin(clients, eq(clients.id, shifts.clientId))
        .where(
          and(
            eq(placements.shiftId, id),
            eq(placements.status, "cancelled"),
            sql`${placements.confirmedAt} IS NOT NULL`,
          ),
        );

      if (affected.length > 0) {
        const { sendEmail, formatShiftWhen } = await import("@/lib/email");
        const { recordEmailMessage, createNotification } = await import(
          "@/lib/integrations"
        );
        for (const a of affected) {
          const shiftWhen = formatShiftWhen(a.startsAt, a.endsAt);
          const companyName = a.companyName ?? "de klant";
          if (a.chefEmail) {
            const send = await sendEmail({
              to: a.chefEmail,
              subject: `Shift geannuleerd: ${a.roleNeeded} bij ${companyName}`,
              react: (
                <div>
                  <h1>Shift geannuleerd</h1>
                  <p>
                    {`Beste ${a.chefName.split(" ")[0]}, de shift op ${shiftWhen} bij ${companyName} is geannuleerd.`}
                  </p>
                  {reason ? <p>{`Reden: ${reason}`}</p> : null}
                  <p>Onze excuses voor het ongemak. Wij nemen contact op zodra er een nieuwe shift is.</p>
                </div>
              ),
            });
            if (send.ok) {
              await recordEmailMessage({
                providerMessageId: send.id,
                toEmail: a.chefEmail,
                template: "ShiftCancelledByAdminChefInline",
                eventKey: "shift_cancelled",
                entityType: "shift",
                entityId: id,
                userId: a.chefUserId ?? undefined,
              });
            }
          }
          if (a.chefUserId) {
            await createNotification({
              userId: a.chefUserId,
              type: "shift_cancelled",
              title: `Shift geannuleerd bij ${companyName}`,
              body: shiftWhen,
              actionUrl: "/chef/shifts",
              entityType: "shift",
              entityId: id,
            });
          }
        }
      }
    } catch (e) {
      console.error("[cancelShift] notification failed:", e);
    }

    redirect(`/admin/business/shifts/${id}?ok=cancelled`);
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

  // PR-INTEL-P5: pair-intel for the chefs who actually have a relationship here
  // (proposed-only chefs share no history yet). Scoped to THIS klant; deduped.
  const pairChefList = (() => {
    const seen = new Set<string>();
    return existingPlacements
      .filter((p) =>
        ["accepted", "confirmed", "completed"].includes(p.placement.status),
      )
      .filter((p) => (seen.has(p.chef.id) ? false : (seen.add(p.chef.id), true)))
      .map((p) => ({ chefId: p.chef.id, chefName: p.chef.fullName }));
  })();
  const pairByChef = new Map<string, PairValue>();
  if (client && pairChefList.length > 0) {
    const rows = await db
      .select({
        chefId: matchIntel.chefId,
        note: matchIntel.note,
        wouldRehire: matchIntel.wouldRehire,
      })
      .from(matchIntel)
      .where(
        and(
          eq(matchIntel.clientId, client.id),
          inArray(
            matchIntel.chefId,
            pairChefList.map((p) => p.chefId),
          ),
        ),
      );
    for (const r of rows) {
      pairByChef.set(r.chefId, { note: r.note, wouldRehire: r.wouldRehire });
    }
  }

  // PR-INTEL-P5: Maarten upserts the chef×klant pair-memory. Partial upsert —
  // never wipes the AI's why-fields. Internal-only; feeds match.intel.
  async function saveMatchIntelAction(formData: FormData) {
    "use server";
    const session = await requirePermission("shifts", "write");
    const chefId = String(formData.get("chefId") ?? "").trim();
    const clientId = String(formData.get("clientId") ?? "").trim();
    if (!chefId || !clientId) return;
    const note = String(formData.get("note") ?? "").trim();
    const rehireRaw = String(formData.get("wouldRehire") ?? "unknown");
    const wouldRehire =
      rehireRaw === "yes" ? true : rehireRaw === "no" ? false : null;
    await saveMatchIntel({
      chefId,
      clientId,
      updatedBy: session.user.id,
      note: note.length > 0 ? note : null,
      wouldRehire,
    });
    await recordAuditFromRequest({
      userId: session.user.id,
      action: "match_intel.upsert",
      resource: "match_intel",
      resourceId: `${chefId}:${clientId}`,
      after: { hasNote: note.length > 0, wouldRehire },
    });
    revalidatePath(`/admin/business/shifts/${id}`);
  }

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

      {flash ? (
        <p
          className={
            flash.tone === "ok"
              ? "mt-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800"
              : flash.tone === "err"
                ? "mt-4 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy"
                : "mt-4 rounded border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
          }
        >
          {flash.text}
        </p>
      ) : null}

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

      {/* CHEF-OPEN: chefs who raised their hand via "Open diensten" (shown
          independently of the algorithmic suggestions). */}
      {interestedChefs.length > 0 ? (
        <section className="mt-6 rounded-lg border border-emerald-300 bg-emerald-50/40 p-5">
          <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Chefs met interesse ({interestedChefs.length})
          </h2>
          <p className="mt-1 text-sm text-ink-700">
            Deze chefs meldden zich aan via &quot;Open diensten&quot;. Stel er één voor om te bevestigen.
          </p>
          <ul className="mt-3 space-y-2">
            {interestedChefs.map((c) => (
              <li
                key={c.chefId}
                className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 bg-white p-3"
              >
                <Link
                  href={`/admin/business/chefs/${c.chefId}`}
                  className="text-sm font-medium text-ink-900 hover:text-burgundy"
                >
                  {c.name}
                </Link>
                <form action={propose}>
                  <input type="hidden" name="chefId" value={c.chefId} />
                  <button className="rounded-full bg-burgundy px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy/90">
                    Voorstel
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
          pairIntelByChef={pairIntelByChef}
          deployByChef={deployByChef}
        />
      )}

      {matches.length === 0 && existingPlacements.length === 0 && <EmptyState />}

      {/* PR-INTEL-P5 — pair-intel for placed chefs at this klant (DICTATE) */}
      {client && (
        <MatchIntelSection
          clientId={client.id}
          clientName={client.companyName}
          placedChefs={pairChefList}
          pairByChef={pairByChef}
          saveAction={saveMatchIntelAction}
        />
      )}

      {/* P3 — cancel the whole dienst. Hidden once cancelled/completed. */}
      {shift.status !== "cancelled" && shift.status !== "completed" && (
        <CancelShiftSection cancelShift={cancelShift} shiftId={shift.id} />
      )}
    </DetailShell>
  );
}

function CancelShiftSection({
  cancelShift,
  shiftId,
}: {
  cancelShift: (formData: FormData) => Promise<void>;
  shiftId: string;
}) {
  return (
    <section className="mt-12 rounded-lg border border-red-200 bg-red-50/50 p-6">
      <h2 className="font-serif text-lg text-red-800">Dienst annuleren</h2>
      <p className="mt-1 text-sm text-ink-700">
        Zet de dienst op <strong>geannuleerd</strong> en trekt alle voorgestelde,
        geaccepteerde en bevestigde plaatsingen in. Bevestigde chefs krijgen
        automatisch bericht. Dit kan niet ongedaan gemaakt worden.
      </p>
      <form action={cancelShift} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="shiftId" value={shiftId} />
        <label className="block flex-1 min-w-[220px]">
          <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-red-700">
            Reden (optioneel)
          </span>
          <input
            type="text"
            name="reason"
            maxLength={500}
            placeholder="bijv. klant heeft het event afgezegd"
            className="w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400"
          />
        </label>
        <button
          type="submit"
          className="rounded-full bg-red-600 px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-red-700"
        >
          Dienst annuleren
        </button>
      </form>
    </section>
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
