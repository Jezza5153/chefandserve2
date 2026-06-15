/**
 * /admin/business — the staffing dashboard (the operator's control room).
 *
 * Owner home screen: bezetting/loonkost overzicht → Vandaag & morgen table →
 * Aandacht-nodig queue (ranked, named, per-row CTA) + Chef spotlight → KPI strip
 * → system footer. Reuses the shipped helpers (roster-format intel, profile-
 * completeness, dashboard-intel ranking) and is honest about missing data.
 *
 * NB: the user-facing name is "Dashboard" (nav + title); the route, the
 * `cockpit.read` permission and the AI-tool internals deliberately keep the
 * "cockpit" identifier (renaming them is churn with no user benefit).
 */

import Link from "next/link";
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";

import { Icon, type IconName } from "@/components/admin/icons";
import { shiftStatusChip } from "@/components/admin/shiftVisuals";
import { OpsCard } from "@/components/dashboard/OpsCard";
import { MoneyStrip } from "@/components/dashboard/MoneyStrip";
import { DrawerShell } from "@/components/dashboard/drawer/DrawerShell";
import { OpenShiftDrawer } from "@/components/dashboard/drawer/OpenShiftDrawer";
import { QueueDrawer, type QueueKind } from "@/components/dashboard/drawer/QueueDrawer";
import { TimelineDrawer } from "@/components/dashboard/drawer/TimelineDrawer";
import { db } from "@/lib/db/client";
import {
  chefSubmissions,
  chefs,
  clientChangeRequests,
  clientSubmissions,
  clients,
  payrollBatches,
  placements,
  profileChangeRequests,
  profileDataRequests,
  shiftHours,
  shifts,
} from "@/lib/db/schema";
import {
  rankAttentionItems,
  weekDelta,
  type AttentionItem,
  type AttentionTone,
} from "@/lib/domain/dashboard-intel";
import { loadSignalStates, isSignalHidden } from "@/lib/domain/dashboard-signal-state";
import { toCard, type CardType } from "@/lib/domain/dashboard-cards";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { CommandBar } from "@/components/dashboard/CommandBar";
import { aiEnabled } from "@/lib/ai/config";
import { snoozeSignal, dismissSignal } from "./_actions";
import { formatShiftRole } from "@/lib/labels";
import { getProfileCompleteness } from "@/lib/domain/profile-completeness";
import { getRosterSettings } from "@/lib/domain/user-settings";
import { getPlatformRollups } from "@/lib/domain/platform-rollups";
import { getUnbilledHoursByClient } from "@/lib/domain/invoicing";
import { detectSwing, getPlatformTimeSeries } from "@/lib/domain/reporting";
import { formatEuro } from "@/lib/hours-labels";
import { requirePermission } from "@/lib/permissions";
import {
  addDaysToKey,
  amsterdamDayKey,
  amsterdamMidnightUtc,
  getShiftHealth,
  needsAttention,
  type ShiftIntelInput,
} from "@/lib/roster-format";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const FILLED_STATUSES = ["confirmed", "accepted"] as const;

export default async function BusinessDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ drawer?: string; shiftId?: string; kind?: string; done?: string }>;
}) {
  const sp = await searchParams;
  const QUEUE_KINDS: QueueKind[] = ["accepted_unconfirmed", "hours_to_approve", "proposed_no_response"];
  const QUEUE_TITLE: Record<QueueKind, string> = {
    accepted_unconfirmed: "Te bevestigen",
    hours_to_approve: "Uren te keuren",
    proposed_no_response: "Wacht op reactie",
  };
  const session = await requirePermission("cockpit", "read");
  const rosterSettings = await getRosterSettings(session.user.id);
  const intelSettings = {
    criticalHours: rosterSettings.criticalHours,
    labels: rosterSettings.labels,
  };

  const now = new Date();
  const todayKey = amsterdamDayKey(now);
  const tomorrowKey = addDaysToKey(todayKey, 1);
  const todayStart = amsterdamMidnightUtc(todayKey);
  const horizonEnd = amsterdamMidnightUtc(addDaysToKey(todayKey, 2)); // end of tomorrow
  const weekFromNow = new Date(now.getTime() + 7 * 864e5);
  const weekAgo = new Date(now.getTime() - 7 * 864e5);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 864e5);
  const fiveDaysAgo = new Date(now.getTime() - 5 * 864e5);

  const [
    horizonShifts,
    horizonPlacements,
    activeChefRows,
    dataReqRows,
    [latestPayroll],
    [{ activeChefs }],
    [{ openShifts }],
    [{ proposedAwaiting }],
    [{ acceptedNotConfirmed }],
    [{ hoursToApprove }],
    [{ hoursKlantTimeout }],
    [{ newChefSubs }],
    [{ newClientSubs }],
    [{ shiftsThisWeek }],
    [{ shiftsPrevWeek }],
    [{ confirmedThisWeek }],
    [{ confirmedPrevWeek }],
    [{ pendingProfileChanges }],
    [{ pendingClientChanges }],
  ] = await Promise.all([
    db
      .select({
        id: shifts.id,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        roleNeeded: shifts.roleNeeded,
        segment: shifts.segment,
        status: shifts.status,
        headcount: shifts.headcount,
        city: shifts.city,
        location: shifts.location,
        clientId: shifts.clientId,
        companyName: clients.companyName,
        chefRateCents: shifts.chefRateCents,
        clientRateCents: shifts.clientRateCents,
      })
      .from(shifts)
      .leftJoin(clients, eq(clients.id, shifts.clientId))
      .where(and(gte(shifts.startsAt, todayStart), lt(shifts.startsAt, horizonEnd)))
      .orderBy(shifts.startsAt),
    // Filled placements (confirmed/accepted) for today+tomorrow — for counts + distinct chefs.
    db
      .select({ shiftId: placements.shiftId, chefId: placements.chefId })
      .from(placements)
      .innerJoin(shifts, eq(shifts.id, placements.shiftId))
      .where(
        and(
          gte(shifts.startsAt, todayStart),
          lt(shifts.startsAt, horizonEnd),
          inArray(placements.status, [...FILLED_STATUSES]),
        ),
      ),
    // Active chefs — completeness columns (small N) for missing-data count + spotlight.
    db
      .select({
        id: chefs.id,
        fullName: chefs.fullName,
        vakniveau: chefs.vakniveau,
        city: chefs.city,
        segments: chefs.segments,
        yearsExperience: chefs.yearsExperience,
        hourlyRateMinCents: chefs.hourlyRateMinCents,
        hourlyRateMaxCents: chefs.hourlyRateMaxCents,
        email: chefs.email,
        phone: chefs.phone,
        specialties: chefs.specialties,
        languages: chefs.languages,
        postcode: chefs.postcode,
        transportMode: chefs.transportMode,
        preferences: chefs.preferences,
      })
      .from(chefs)
      .where(and(isNull(chefs.deletedAt), eq(chefs.status, "active"))),
    // Chefs with an outstanding (sent, not completed) profile-data request → spotlight "opgevraagd".
    db
      .select({ chefId: profileDataRequests.chefId, fullName: chefs.fullName })
      .from(profileDataRequests)
      .innerJoin(chefs, eq(chefs.id, profileDataRequests.chefId))
      .where(eq(profileDataRequests.status, "sent"))
      .limit(10),
    db.select({ closedAt: payrollBatches.createdAt }).from(payrollBatches).orderBy(desc(payrollBatches.createdAt)).limit(1),
    db.select({ activeChefs: sql<number>`count(*)::int` }).from(chefs).where(and(isNull(chefs.deletedAt), eq(chefs.status, "active"))),
    db.select({ openShifts: sql<number>`count(*)::int` }).from(shifts).where(and(eq(shifts.status, "open"), gte(shifts.startsAt, now))),
    db.select({ proposedAwaiting: sql<number>`count(*)::int` }).from(placements).where(eq(placements.status, "proposed")),
    db.select({ acceptedNotConfirmed: sql<number>`count(*)::int` }).from(placements).where(eq(placements.status, "accepted")),
    db.select({ hoursToApprove: sql<number>`count(*)::int` }).from(shiftHours).where(eq(shiftHours.status, "client_signed")),
    db.select({ hoursKlantTimeout: sql<number>`count(*)::int` }).from(shiftHours).where(and(eq(shiftHours.status, "submitted"), lt(shiftHours.submittedAt, fiveDaysAgo))),
    db.select({ newChefSubs: sql<number>`count(*)::int` }).from(chefSubmissions).where(and(eq(chefSubmissions.status, "new"), gte(chefSubmissions.createdAt, weekAgo))),
    db.select({ newClientSubs: sql<number>`count(*)::int` }).from(clientSubmissions).where(and(eq(clientSubmissions.status, "new"), gte(clientSubmissions.createdAt, weekAgo))),
    db.select({ shiftsThisWeek: sql<number>`count(*)::int` }).from(shifts).where(and(gte(shifts.startsAt, now), lt(shifts.startsAt, weekFromNow))),
    db.select({ shiftsPrevWeek: sql<number>`count(*)::int` }).from(shifts).where(and(gte(shifts.startsAt, weekAgo), lt(shifts.startsAt, now))),
    // PR-AUDIT-3: bucket by confirmedAt (when it was confirmed), not createdAt
    // (when the placement row was first created) — else count + WoW arrow skew.
    db.select({ confirmedThisWeek: sql<number>`count(*)::int` }).from(placements).where(and(eq(placements.status, "confirmed"), gte(placements.confirmedAt, weekAgo))),
    db.select({ confirmedPrevWeek: sql<number>`count(*)::int` }).from(placements).where(and(eq(placements.status, "confirmed"), gte(placements.confirmedAt, twoWeeksAgo), lt(placements.confirmedAt, weekAgo))),
    db.select({ pendingProfileChanges: sql<number>`count(*)::int` }).from(profileChangeRequests).where(eq(profileChangeRequests.status, "pending")),
    db.select({ pendingClientChanges: sql<number>`count(*)::int` }).from(clientChangeRequests).where(eq(clientChangeRequests.status, "pending")),
  ]);

  // KPI-5: owner money overview (week/maand/YTD FINAL-hours rollups).
  const roll = await getPlatformRollups();
  // Proactive billing nudge: approved hours not yet on any invoice.
  const unbilledList = await getUnbilledHoursByClient();
  const unbilledCents = unbilledList.reduce((sum, u) => sum + u.totalCents, 0);
  // Anomaly: a noise-guarded week-over-week revenue swing (C5).
  const weekSeries = await getPlatformTimeSeries({ bucket: "week" });
  const revSwing = detectSwing(weekSeries.points, "revenueCents");

  /* ---- derive per-shift intel + day metrics ---- */
  const countByShift = new Map<string, number>();
  const chefsByDay = new Map<string, Set<string>>();
  for (const p of horizonPlacements) {
    countByShift.set(p.shiftId, (countByShift.get(p.shiftId) ?? 0) + 1);
  }
  const shiftDayKey = new Map(horizonShifts.map((s) => [s.id, amsterdamDayKey(s.startsAt)]));
  for (const p of horizonPlacements) {
    const day = shiftDayKey.get(p.shiftId);
    if (!day) continue;
    if (!chefsByDay.has(day)) chefsByDay.set(day, new Set());
    chefsByDay.get(day)!.add(p.chefId);
  }

  function intel(s: (typeof horizonShifts)[number]): ShiftIntelInput {
    return {
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      status: s.status,
      headcount: s.headcount,
      confirmedCount: countByShift.get(s.id) ?? 0,
      location: s.location,
      city: s.city,
      hasClient: s.companyName != null,
      settings: intelSettings,
      now,
    };
  }

  const todayShifts = horizonShifts.filter((s) => shiftDayKey.get(s.id) === todayKey);
  const tomorrowShifts = horizonShifts.filter((s) => shiftDayKey.get(s.id) === tomorrowKey);

  function dayMetrics(dayShifts: typeof horizonShifts, dayKey: string) {
    let slots = 0;
    let filled = 0;
    let loonCents = 0;
    let rateMissing = 0;
    const clientSet = new Set<string>();
    for (const s of dayShifts) {
      const cnt = Math.min(countByShift.get(s.id) ?? 0, s.headcount);
      slots += s.headcount;
      filled += cnt;
      clientSet.add(s.clientId);
      if (s.chefRateCents) {
        const hours = (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 3_600_000;
        loonCents += cnt * s.chefRateCents * hours;
      } else if (cnt > 0) {
        // PR-AUDIT-9: a filled slot with no chefRateCents → loonkost undercounts.
        rateMissing += 1;
      }
    }
    return {
      slots,
      filled,
      pct: slots > 0 ? Math.round((filled / slots) * 100) : 0,
      chefs: chefsByDay.get(dayKey)?.size ?? 0,
      clients: clientSet.size,
      loonEur: Math.round(loonCents / 100),
      rateMissing,
    };
  }
  const todayMetrics = dayMetrics(todayShifts, todayKey);
  const tomorrowMetrics = dayMetrics(tomorrowShifts, tomorrowKey);
  const tomorrowAttention = tomorrowShifts.filter((s) => needsAttention(intel(s))).length;

  /* ---- chef completeness (missing-data count + spotlight) ---- */
  const requestedChefIds = new Set(dataReqRows.map((r) => r.chefId));
  const missingChefs = activeChefRows
    .map((c) => {
      const comp = getProfileCompleteness({
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
        postcode: c.postcode,
        transportMode: c.transportMode,
        preferences: c.preferences,
      });
      return { id: c.id, name: c.fullName, comp };
    })
    .filter((c) => c.comp.missingCritical.length > 0 || !c.comp.canEstimateTravel);
  const missingDataCount = missingChefs.length;

  function missingLabel(c: (typeof missingChefs)[number]): string {
    if (requestedChefIds.has(c.id)) return "Gegevens opgevraagd";
    if (c.comp.missingCritical.length > 0) return `${cap(c.comp.missingCritical[0])} ontbreekt`;
    if (!c.comp.canEstimateTravel) return "Postcode ontbreekt";
    return "Profiel onvolledig";
  }
  const spotlight = missingChefs.slice(0, 4).map((c) => ({
    id: c.id,
    name: c.name,
    status: missingLabel(c),
    tone: requestedChefIds.has(c.id) ? ("blue" as const) : ("amber" as const),
  }));

  /* ---- build the Aandacht-nodig queue ---- */
  const items: AttentionItem[] = [];
  for (const s of horizonShifts) {
    const inp = intel(s);
    if (!needsAttention(inp)) continue;
    const health = getShiftHealth(inp);
    const cnt = countByShift.get(s.id) ?? 0;
    const open = Math.max(s.headcount - cnt, 0);
    const dayLabel = shiftDayKey.get(s.id) === todayKey ? "Vandaag" : "Morgen";
    const kind =
      health === "critical" ? "critical_shift" : health === "empty" ? "open_shift" : "underfilled_shift";
    items.push({
      kind,
      tone: kind === "critical_shift" ? "red" : "amber",
      icon: "alert-triangle",
      title: `${s.companyName ?? "Onbekende klant"} · ${dayLabel} ${hhmm(s.startsAt)}`,
      detail: open > 0 ? `mist ${open} chef${open === 1 ? "" : "s"} · ${cnt}/${s.headcount} bemand` : `${cnt}/${s.headcount} bemand`,
      // DASH-2a: open the "Vul deze dienst" drawer in place (search-param driven) instead of a page jump.
      href: `/admin/business?drawer=open-shift&shiftId=${s.id}`,
      cta: "Vul deze dienst",
      signalKey: `${kind}:${s.id}`,
      fingerprint: `${health}:${cnt}/${s.headcount}`,
    });
  }
  if (acceptedNotConfirmed > 0)
    items.push({ kind: "accepted_unconfirmed", tone: "amber", icon: "alert-triangle", title: `${acceptedNotConfirmed} ${plural(acceptedNotConfirmed, "shift wacht", "shifts wachten")} op bevestiging`, detail: "chef zei ja — bevestig met de klant", href: "/admin/business?drawer=queue&kind=accepted_unconfirmed", cta: "Bevestigen", signalKey: "accepted_unconfirmed", fingerprint: String(acceptedNotConfirmed) });
  if (proposedAwaiting > 0)
    items.push({ kind: "proposed_no_response", tone: "blue", icon: "info", title: `${proposedAwaiting} ${plural(proposedAwaiting, "chef voorgesteld", "chefs voorgesteld")}`, detail: "wacht op reactie van de chef", href: "/admin/business?drawer=queue&kind=proposed_no_response", cta: "Opvolgen", signalKey: "proposed_no_response", fingerprint: String(proposedAwaiting) });
  if (hoursToApprove > 0)
    items.push({ kind: "hours_to_approve", tone: "amber", icon: "clock", title: `${hoursToApprove} ${plural(hoursToApprove, "urenbriefje", "urenbriefjes")} te keuren`, detail: "klant heeft getekend", href: "/admin/business?drawer=queue&kind=hours_to_approve", cta: "Keur uren", signalKey: "hours_to_approve", fingerprint: String(hoursToApprove) });
  const pendingChanges = pendingProfileChanges + pendingClientChanges;
  if (pendingChanges > 0)
    items.push({ kind: "change_request", tone: "blue", icon: "info", title: `${pendingChanges} ${plural(pendingChanges, "profielupdate wacht", "profielupdates wachten")}`, detail: "wijzigingsverzoeken ter beoordeling", href: pendingProfileChanges >= pendingClientChanges ? "/admin/business/chefs" : "/admin/business/clients", cta: "Bekijken", signalKey: "change_request", fingerprint: String(pendingChanges) });
  const inboxCount = newChefSubs + newClientSubs;
  if (inboxCount > 0)
    items.push({ kind: "inbox", tone: "blue", icon: "inbox", title: `${inboxCount} nieuwe ${plural(inboxCount, "aanmelding", "aanmeldingen")}`, detail: `${newChefSubs} chef · ${newClientSubs} klant`, href: "/admin/business/inbox", cta: "Open inbox", signalKey: "inbox", fingerprint: String(inboxCount) });
  if (missingDataCount > 0)
    items.push({ kind: "missing_data", tone: "amber", icon: "user-round", title: `${missingDataCount} chef-${plural(missingDataCount, "profiel", "profielen")} onvolledig`, detail: "postcode of tarief ontbreekt", href: "/admin/business/chefs?data=incomplete", cta: "Aanvullen", signalKey: "missing_data", fingerprint: String(missingDataCount) });

  // DASH-3b: drop snoozed/dismissed signals (the snooze auto-reappears; the dismiss
  // auto-reappears the moment its fingerprint changes). `ranked` is the live, non-hidden
  // set, so every downstream count reflects what actually needs attention now.
  const rankedAll = rankAttentionItems(items);
  const signalStates = await loadSignalStates(session.user.id);
  const ranked = rankedAll.filter((it) => !isSignalHidden(signalStates.get(it.signalKey ?? ""), it.fingerprint, now));
  const visible = ranked.slice(0, 6);

  // DASH-4: control-room banner — "vandaag onder controle / N aandachtspunten" + Fix-first.
  const sev = {
    spoed: ranked.filter((r) => r.kind === "critical_shift").length,
    open: ranked.filter((r) => r.kind === "open_shift" || r.kind === "underfilled_shift").length,
    bevestigen: ranked.filter((r) => r.kind === "accepted_unconfirmed").length,
    uren: ranked.filter((r) => r.kind === "hours_to_approve").length,
  };
  const breakdown = [
    sev.spoed && `${sev.spoed} spoed`,
    sev.open && `${sev.open} open`,
    sev.bevestigen && `${sev.bevestigen} te bevestigen`,
    sev.uren && `${sev.uren} uren`,
  ].filter(Boolean).join(" · ");
  const fixFirstHref = ranked[0]?.href;
  const lastUpdated = now.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
  // Command bar only when the assistant is actually available (dashboard viewers are
  // owner/super_admin, so the role half of `showAssistant` is already satisfied).
  const aiAvailable = aiEnabled();

  // DASH-6a: revenue-at-risk — unfilled slots today+tomorrow × client rate × hours.
  // Honest: only counts shifts with a known client rate (rateless ones can't be valued).
  let revenueAtRiskCents = 0;
  let unfilledShiftCount = 0;
  for (const s of horizonShifts) {
    const cntFilled = Math.min(countByShift.get(s.id) ?? 0, s.headcount);
    const openSlots = Math.max(s.headcount - cntFilled, 0);
    if (openSlots > 0) {
      unfilledShiftCount += 1;
      if (s.clientRateCents) {
        const hours = (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 3_600_000;
        revenueAtRiskCents += openSlots * s.clientRateCents * hours;
      }
    }
  }
  // The most urgent unfilled shift to send "Vul nu" at (its fill drawer); else the roster.
  const topOpenShiftHref =
    ranked.find((r) => r.kind === "critical_shift" || r.kind === "open_shift" || r.kind === "underfilled_shift")?.href ??
    "/admin/business/roster";

  /* ---- header bits ---- */
  const roles = session.user.roles;
  const roleLabel = roles.includes("owner") ? "Eigenaar" : roles.includes("super_admin") ? "Beheerder" : "Team";
  const firstName = session.user.name?.split(" ")[0];
  const dateLabel = cap(now.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }));
  const subtitle =
    tomorrowAttention > 0
      ? `Morgen ${plural(tomorrowAttention, "vraagt", "vragen")} ${tomorrowAttention} ${plural(tomorrowAttention, "dienst", "diensten")} aandacht.`
      : ranked.length > 0
        ? `${ranked.length} ${plural(ranked.length, "ding vraagt", "dingen vragen")} je aandacht.`
        : "Alles loopt. Bekijk het rooster of de openstaande acties.";

  const shiftsDelta = weekDelta(shiftsThisWeek, shiftsPrevWeek);
  const confirmedDelta = weekDelta(confirmedThisWeek, confirmedPrevWeek);

  return (
    <div className="-mx-6 -my-10 md:-mx-10 md:-my-12">
      <div className="px-6 py-7 md:px-10 md:py-8">

        {/* Confirmation flash — every drawer/rail action redirects here with ?done= */}
        {sp.done && <DoneFlash done={sp.done} />}

        {/* In-place drawers (search-param driven) — fix the signal without a page jump */}
        {sp.drawer === "open-shift" && sp.shiftId && (
          <DrawerShell title="Vul deze dienst" closeHref="/admin/business">
            <OpenShiftDrawer shiftId={sp.shiftId} />
          </DrawerShell>
        )}
        {sp.drawer === "queue" && sp.kind && QUEUE_KINDS.includes(sp.kind as QueueKind) && (
          <DrawerShell title={QUEUE_TITLE[sp.kind as QueueKind]} closeHref="/admin/business">
            <QueueDrawer kind={sp.kind as QueueKind} />
          </DrawerShell>
        )}
        {sp.drawer === "timeline" && sp.shiftId && (
          <DrawerShell title="Tijdlijn" closeHref="/admin/business">
            <TimelineDrawer shiftId={sp.shiftId} />
          </DrawerShell>
        )}

        {/* Top bar */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-ui text-[11px] uppercase tracking-[0.2em] text-ink-500">Operations · {roleLabel}</p>
            <h1 className="mt-1 font-serif text-3xl text-ink-900 md:text-4xl">
              {greeting()}
              {firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="mt-1 text-sm text-ink-700">{subtitle}</p>
          </div>
          <span className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 font-ui text-[12px] text-ink-700">
            <Icon name="calendar" className="h-4 w-4" /> {dateLabel}
          </span>
        </div>

        {/* Action toolbar */}
        <div className="mt-5 flex flex-wrap gap-2">
          <ToolbarLink href="/admin/business/shifts/new" icon="plus-circle" label="Nieuwe shift" primary />
          <ToolbarLink href="/admin/business/templates" icon="copy" label="Shift kopiëren" />
          <ToolbarLink href="/admin/business/chefs" icon="search" label="Chef zoeken" />
          <ToolbarLink href="/admin/business/inbox" icon="message" label="Berichten" />
          <ToolbarLink href="/admin/business/payroll" icon="upload" label="Exporteren" />
        </div>

        {/* DASH-5b: operations command bar — type an intent, the assistant resolves it */}
        {aiAvailable && <CommandBar />}

        {/* DASH-4: control-room banner — instant safe/not-safe read + Fix-first */}
        <div
          className={`mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-5 py-4 ${
            ranked.length === 0
              ? "border-emerald-200 bg-emerald-50"
              : sev.spoed > 0
                ? "border-red-300 bg-red-50"
                : "border-amber-300 bg-amber-50"
          }`}
        >
          <div className="min-w-0">
            <p
              className={`font-serif text-lg ${
                ranked.length === 0 ? "text-emerald-800" : sev.spoed > 0 ? "text-red-800" : "text-amber-900"
              }`}
            >
              {ranked.length === 0
                ? "Vandaag onder controle"
                : `Vandaag: ${ranked.length} ${plural(ranked.length, "aandachtspunt", "aandachtspunten")}`}
            </p>
            <p className="mt-0.5 text-xs text-ink-600">
              {ranked.length === 0 ? "Geen open risico's — alles loopt op schema." : breakdown || "verspreide signalen"}
              <span className="text-ink-400"> · laatst bijgewerkt {lastUpdated}</span>
            </p>
          </div>
          {fixFirstHref && (
            <Link
              href={fixFirstHref}
              className="shrink-0 rounded-full bg-burgundy px-4 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900"
            >
              Pak het belangrijkste op →
            </Link>
          )}
        </div>

        {/* Keep the rail + banner quietly current; strip the ?done= toast after ~6s. */}
        <AutoRefresh seconds={60} clearParam="done" />

        {/* Rooster overzicht — bezetting / loonkost */}
        <section className="mt-6">
          <div className="flex items-baseline justify-between">
            <h2 className="font-serif text-xl text-ink-900">Rooster overzicht</h2>
            <Link href="/admin/business/roster" className="flex items-center gap-1 font-ui text-[12px] font-medium text-burgundy hover:underline">
              Bekijk volledig rooster <Icon name="arrow-right" className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <BezettingCard label="Vandaag" date={cap(now.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Amsterdam" }))} accent metrics={todayMetrics} href="/admin/business/roster" cta="Bekijk vandaag" />
            <BezettingCard label="Morgen" date={cap(new Date(now.getTime() + 864e5).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Amsterdam" }))} metrics={tomorrowMetrics} href="/admin/business/roster" cta="Bekijk morgen" />
          </div>
        </section>

        {/* Vandaag & morgen table + right rail */}
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="overflow-hidden rounded-xl border border-ink-200 bg-white">
            <div className="px-5 pt-4 pb-2">
              <h2 className="font-serif text-xl text-ink-900">Vandaag &amp; morgen</h2>
            </div>
            <DayTable title={`Vandaag · ${cap(now.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Amsterdam" }))}`} accent shifts={todayShifts} countByShift={countByShift} />
            <DayTable title={`Morgen · ${cap(new Date(now.getTime() + 864e5).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Amsterdam" }))}`} shifts={tomorrowShifts} countByShift={countByShift} />
            {horizonShifts.length === 0 && (
              <div className="px-5 py-10 text-center">
                <p className="font-serif text-lg text-ink-900">Geen diensten vandaag of morgen</p>
                <p className="mt-1 text-sm text-ink-500">Maak een shift aan of verwerk een aanvraag uit de inbox.</p>
                <div className="mt-4 flex justify-center gap-2">
                  <Link href="/admin/business/shifts/new" className="rounded-full bg-burgundy px-4 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900">Nieuwe shift</Link>
                  <Link href="/admin/business/inbox" className="rounded-full border border-ink-200 px-4 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-ink-700 hover:border-burgundy hover:text-burgundy">Open inbox</Link>
                </div>
              </div>
            )}
            <Link href="/admin/business/roster" className="flex items-center gap-1 px-5 py-3 font-ui text-[12px] font-medium text-burgundy hover:underline">
              Naar volledig rooster <Icon name="arrow-right" className="h-3.5 w-3.5" />
            </Link>
          </section>

          {/* Right rail */}
          <div className="space-y-5">
            <section className="rounded-xl border border-ink-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-lg text-ink-900">Aandacht nodig</h2>
                {ranked.length > 0 && (
                  <span className="rounded-full bg-burgundy px-1.5 py-0.5 text-[10px] font-semibold text-white">{ranked.length}</span>
                )}
              </div>
              {visible.length === 0 ? (
                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-4">
                  <p className="text-sm font-medium text-emerald-800">✓ Alles onder controle</p>
                  <p className="mt-0.5 text-xs text-ink-600">
                    {horizonShifts.length === 0
                      ? "Er staan nog geen diensten gepland."
                      : "Geen open risico's. Een blik op vandaag & morgen:"}
                  </p>
                  {horizonShifts.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-ink-700">
                      <li>· {todayShifts.length} {plural(todayShifts.length, "dienst", "diensten")} vandaag</li>
                      <li>· {tomorrowShifts.length} {plural(tomorrowShifts.length, "dienst", "diensten")} morgen</li>
                    </ul>
                  )}
                  <Link
                    href="/admin/business/roster"
                    className="mt-2 inline-block font-ui text-[11px] uppercase tracking-[0.14em] text-burgundy hover:underline"
                  >
                    Bekijk het rooster →
                  </Link>
                </div>
              ) : (
                <div className="mt-3 divide-y divide-ink-100">
                  {visible.map((it, i) => (
                    <AttentionRow key={i} item={it} />
                  ))}
                </div>
              )}
              {ranked.length > visible.length && (
                <Link href="/admin/business/roster" className="mt-3 inline-block font-ui text-[11px] uppercase tracking-[0.16em] text-burgundy hover:underline">
                  Bekijk alles ({ranked.length}) →
                </Link>
              )}
            </section>

            {spotlight.length > 0 && (
              <section className="rounded-xl border border-ink-200 bg-white p-5">
                <h2 className="font-serif text-lg text-ink-900">Chef spotlight</h2>
                <div className="mt-3 space-y-3">
                  {spotlight.map((c) => (
                    <Link key={c.id} href={`/admin/business/chefs/${c.id}`} className="flex items-center gap-3 hover:opacity-80">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-burgundy/10 font-ui text-[12px] font-semibold text-burgundy">{initials(c.name)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink-900">{c.name}</p>
                        <p className="truncate text-xs text-ink-500">{c.status}</p>
                      </div>
                      <span className={`h-2 w-2 rounded-full ${c.tone === "blue" ? "bg-blue-500" : "bg-amber-500"}`} />
                    </Link>
                  ))}
                </div>
                <Link href="/admin/business/chefs" className="mt-4 flex items-center gap-1 font-ui text-[12px] font-medium text-burgundy hover:underline">
                  Naar chefs <Icon name="arrow-right" className="h-3.5 w-3.5" />
                </Link>
              </section>
            )}
          </div>
        </div>

        {/* KPI strip */}
        <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <OpsCard icon="calendar" label="Diensten · deze week" value={shiftsThisWeek} href="/admin/planning" cta="Naar planning"
            lines={[{ text: `${openShifts} open` }, deltaLine(shiftsDelta)]} />
          <OpsCard icon="users" label="Chefs" value={activeChefs} href="/admin/business/chefs" cta="Naar chefs"
            lines={[{ text: "actief" }, missingDataCount > 0 ? { text: `${missingDataCount} mist profieldata`, tone: "amber" } : { text: "data compleet", tone: "muted" }]} />
          <OpsCard icon="inbox" label="Inbox" value={inboxCount} badge={inboxCount} href="/admin/business/inbox" cta="Naar inbox"
            lines={[{ text: "nieuwe aanvragen" }, { text: `${newChefSubs} chef · ${newClientSubs} klant`, tone: "muted" }]} />
          <OpsCard icon="clock" label="Uren" value={hoursToApprove} href="/admin/business/hours?filter=wacht_op_mij" cta="Naar uren"
            lines={[{ text: "te keuren" }, hoursKlantTimeout > 0 ? { text: `${hoursKlantTimeout} wacht op klant`, tone: "amber" } : { text: "geen achterstand", tone: "muted" }]} />
          <OpsCard icon="check-circle" label="Bevestigd" value={confirmedThisWeek} href="/admin/business/shifts" cta="Naar shifts"
            lines={[{ text: "deze week" }, deltaLine(confirmedDelta)]} />
          <OpsCard icon="user-round" label="Profieldata" value={missingDataCount} href="/admin/business/chefs?data=incomplete" cta="Naar overzicht"
            lines={[{ text: "ontbrekend" }, missingDataCount > 0 ? { text: "actie vereist", tone: "amber" } : { text: "compleet", tone: "emerald" }]} />
        </div>

        {/* KPI-5: money overview (FINAL hours) */}
        <div className="mt-6">
          <h2 className="mb-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-500">Omzet &amp; marge</h2>
          <MoneyStrip week={roll.week} month={roll.month} ytd={roll.ytd} />
          {revenueAtRiskCents > 0 ? (
            <Link
              href={topOpenShiftHref}
              className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50/60 px-4 py-2.5 hover:border-burgundy/40"
            >
              <span className="text-sm text-ink-700">
                <strong className="text-ink-900">{formatEuro(revenueAtRiskCents)}</strong> omzet loopt risico —{" "}
                {unfilledShiftCount} {plural(unfilledShiftCount, "onvervulde dienst", "onvervulde diensten")} vandaag &amp; morgen
              </span>
              <span className="shrink-0 font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">Vul nu →</span>
            </Link>
          ) : null}
          {unbilledCents > 0 ? (
            <Link
              href="/admin/business/invoices"
              className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2.5 hover:border-burgundy/40"
            >
              <span className="text-sm text-ink-700">
                <strong className="text-ink-900">{formatEuro(unbilledCents)}</strong> aan
                goedgekeurde uren te factureren
              </span>
              <span className="shrink-0 font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
                Maak facturen →
              </span>
            </Link>
          ) : null}
          {revSwing ? (
            <div
              className={`mt-3 rounded-lg border px-4 py-2.5 text-sm ${
                revSwing.direction === "down"
                  ? "border-amber-200 bg-amber-50/60 text-amber-800"
                  : "border-emerald-200 bg-emerald-50/60 text-emerald-800"
              }`}
            >
              {revSwing.direction === "down" ? "↓" : "↑"} Omzet deze week{" "}
              <strong>
                {revSwing.pct}% {revSwing.direction === "down" ? "lager" : "hoger"}
              </strong>{" "}
              dan vorige week ({formatEuro(revSwing.prevCents)} → {formatEuro(revSwing.lastCents)}).{" "}
              <Link href="/admin/business/reporting" className="underline">
                Bekijk rapportage
              </Link>
            </div>
          ) : null}
        </div>

        {/* Operational footer — system/integration health lives on the
            super_admin /admin/system + /admin/business/integrations surfaces
            (owners don't manage error-handling). */}
        {latestPayroll?.closedAt && (
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-ink-200 pt-4 font-ui text-[11px] text-ink-500">
            <span>Laatste payroll-export {new Date(latestPayroll.closedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: "Europe/Amsterdam" })}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ----- inline presentational helpers ----- */

function ToolbarLink({ href, icon, label, primary }: { href: string; icon: IconName; label: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "flex items-center gap-2 rounded-full bg-burgundy px-4 py-2 font-ui text-[12px] font-medium text-white hover:bg-burgundy-900"
          : "flex items-center gap-2 rounded-full border border-ink-200 bg-white px-4 py-2 font-ui text-[12px] text-ink-700 hover:border-burgundy/40 hover:text-burgundy"
      }
    >
      <Icon name={icon} className="h-4 w-4" />
      {label}
    </Link>
  );
}

type DayMetrics = { slots: number; filled: number; pct: number; chefs: number; clients: number; loonEur: number; rateMissing: number };

function BezettingCard({ label, date, metrics, href, cta, accent }: { label: string; date: string; metrics: DayMetrics; href: string; cta: string; accent?: boolean }) {
  const barTone = metrics.pct >= 80 ? "bg-emerald-500" : metrics.pct >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className={`font-ui text-[11px] font-semibold uppercase tracking-[0.16em] ${accent ? "text-burgundy" : "text-ink-700"}`}>{label}</p>
          <p className="text-sm text-ink-500">{date}</p>
        </div>
        <Icon name={accent ? "sun" : "cloud"} className={`h-5 w-5 ${accent ? "text-amber-500" : "text-ink-500"}`} />
      </div>
      <div className="mt-4 flex items-end gap-8">
        <div>
          <p className="font-serif text-4xl text-ink-900">{metrics.filled} <span className="text-2xl text-ink-500">/ {metrics.slots}</span></p>
          <p className="font-ui text-[11px] uppercase tracking-[0.14em] text-ink-500">ingevuld</p>
        </div>
        <div>
          <p className="font-serif text-4xl text-ink-900">{metrics.pct}%</p>
          <p className="font-ui text-[11px] uppercase tracking-[0.14em] text-ink-500">bezetting</p>
        </div>
      </div>
      <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-ink-100">
        <div className={`h-full rounded-full ${barTone}`} style={{ width: `${metrics.pct}%` }} />
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-ink-100 pt-3 text-sm">
        <span className="text-ink-700"><b className="font-semibold text-ink-900">{metrics.chefs}</b> Chefs</span>
        <span className="text-ink-700"><b className="font-semibold text-ink-900">{metrics.clients}</b> Klanten</span>
        <span className="text-ink-700" title={metrics.rateMissing > 0 ? `${metrics.rateMissing} shift(s) zonder tarief — niet meegerekend in loonkost` : undefined}><b className="font-semibold text-ink-900">€{metrics.loonEur.toLocaleString("nl-NL")}{metrics.rateMissing > 0 ? "*" : ""}</b> Loonkost</span>
      </div>
      <Link href={href} className="mt-4 flex items-center justify-center gap-1 rounded-lg border border-burgundy/40 py-2.5 font-ui text-[12px] font-medium text-burgundy hover:bg-burgundy/5">
        {cta} <Icon name="arrow-right" className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function DayTable({ title, shifts: dayShifts, countByShift, accent }: { title: string; shifts: { id: string; startsAt: Date; endsAt: Date; roleNeeded: string; status: string; headcount: number; city: string | null; companyName: string | null }[]; countByShift: Map<string, number>; accent?: boolean }) {
  if (dayShifts.length === 0) return null;
  return (
    <>
      <div className={`flex items-center justify-between gap-2 border-y border-ink-100 px-5 py-2 ${accent ? "bg-burgundy/5" : "bg-bg-gray"}`}>
        <span className={`font-ui text-[11px] font-semibold uppercase tracking-[0.16em] ${accent ? "text-burgundy" : "text-ink-700"}`}>{title}</span>
        <span className="font-ui text-[11px] text-ink-500">{dayShifts.length} {plural(dayShifts.length, "dienst", "diensten")}</span>
      </div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-ink-100">
          {dayShifts.map((s) => {
            const cnt = countByShift.get(s.id) ?? 0;
            const chip = shiftStatusChip({ status: s.status, confirmedCount: cnt, headcount: s.headcount });
            return (
              <tr key={s.id} className="hover:bg-bg-gray">
                <td className="px-5 py-3 font-ui text-[13px] text-ink-900 whitespace-nowrap align-top">{hhmm(s.startsAt)}–{hhmm(s.endsAt)}</td>
                <td className="px-2 py-3 align-top"><p className="text-ink-900">{s.companyName ?? "Onbekende klant"}</p><p className="text-xs text-ink-500">{formatShiftRole(s.roleNeeded)}{s.city ? ` · ${s.city}` : ""}</p></td>
                <td className="px-2 py-3 align-top"><span className={`inline-flex items-center gap-1.5 ${chip.text}`}><span className={`h-2 w-2 rounded-full ${chip.dot}`} />{chip.label}</span></td>
                <td className={`px-2 py-3 align-top font-ui ${chip.text}`}>{cnt} / {s.headcount}</td>
                <td className="px-3 py-3 align-top text-ink-500"><Link href={`/admin/business/shifts/${s.id}`}><Icon name="chevron-right" className="h-[18px] w-[18px]" /></Link></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

const TONE_ICON_CLASS: Record<AttentionTone, string> = {
  red: "text-red-600",
  amber: "text-amber-600",
  blue: "text-blue-600",
  grey: "text-ink-500",
};

function DoneFlash({ done }: { done: string }) {
  const MAP: Record<string, { msg: string; tone: "good" | "warn" | "info" }> = {
    voorstel: { msg: "✓ Voorgesteld — de chef krijgt de aanvraag. Gelogd.", tone: "good" },
    "al-voorgesteld": { msg: "Deze chef stond al op deze dienst.", tone: "info" },
    bevestigd: { msg: "✓ Bevestigd — chef en klant zijn op de hoogte. Gelogd.", tone: "good" },
    "niet-bevestigd": { msg: "Niets gewijzigd — de dienst was al bevestigd of veranderd.", tone: "warn" },
    "uren-goedgekeurd": { msg: "✓ Uren goedgekeurd — klaar voor de loonadministratie.", tone: "good" },
    "uren-mislukt": { msg: "Uren konden niet worden goedgekeurd — open het urenbriefje.", tone: "warn" },
    "contact-gelogd": { msg: "✓ Contact gelogd — zichtbaar op de tijdlijn.", tone: "good" },
    snoozed: { msg: "Signaal gesnoozed — komt over 4 uur terug.", tone: "info" },
    opgelost: { msg: "✓ Gemarkeerd als opgelost. Komt terug als de situatie verandert.", tone: "good" },
    "reden-vereist": { msg: "Geef een reden op om een signaal als opgelost te markeren.", tone: "warn" },
  };
  const f = MAP[done] ?? { msg: "✓ Gelogd.", tone: "good" as const };
  const cls =
    f.tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : f.tone === "warn"
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : "border-ink-200 bg-bg-gray text-ink-700";
  return <div className={`mb-4 rounded-lg border px-4 py-2.5 text-sm ${cls}`}>{f.msg}</div>;
}

const CARD_TYPE_CHIP: Record<CardType, { label: string; cls: string }> = {
  fire: { label: "Spoed", cls: "bg-red-100 text-red-700" },
  risk: { label: "Risico", cls: "bg-amber-100 text-amber-800" },
  money: { label: "Geld", cls: "bg-emerald-100 text-emerald-700" },
  task: { label: "Taak", cls: "bg-blue-100 text-blue-700" },
  opportunity: { label: "Kans", cls: "bg-emerald-100 text-emerald-700" },
};

function AttentionRow({ item }: { item: AttentionItem }) {
  const chip = CARD_TYPE_CHIP[toCard(item).cardType];
  // Dismiss only on per-shift signals (their fingerprint auto-clears correctly); aggregates snooze-only.
  const dismissable =
    item.kind === "critical_shift" || item.kind === "open_shift" || item.kind === "underfilled_shift";
  return (
    <div className="-mx-2 rounded px-2 py-2 hover:bg-bg-gray">
      <Link href={item.href} className="flex items-start gap-3 py-1">
        <span className={`mt-0.5 ${TONE_ICON_CLASS[item.tone]}`}><Icon name={item.icon} className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${chip.cls}`}>{chip.label}</span>
            <p className="truncate text-sm text-ink-900">{item.title}</p>
          </div>
          {item.detail && <p className="text-xs text-ink-500">{item.detail}</p>}
        </div>
        {item.cta && <span className="mt-0.5 shrink-0 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-burgundy">{item.cta}</span>}
      </Link>
      {/* DASH-3b: snooze (time-based, all signals) + dismiss-with-reason. Dismiss is shown
          ONLY for per-shift signals, whose fingerprint (health:cnt/headcount) auto-clears
          correctly; count-aggregate signals get snooze only (their bare-count fingerprint
          would keep a dismiss alive even when the underlying items change — HARDEN-3). */}
      {item.signalKey && (
        <div className="mt-1 flex flex-wrap items-center gap-2 pl-[30px]">
          <form action={snoozeSignal}>
            <input type="hidden" name="signalKey" value={item.signalKey} />
            <input type="hidden" name="hours" value="4" />
            <button type="submit" className="font-ui text-[10px] font-medium uppercase tracking-[0.1em] text-ink-400 hover:text-burgundy">
              Snooze 4u
            </button>
          </form>
          {dismissable && (
            <>
              <span className="text-[10px] text-ink-200">·</span>
              <form action={dismissSignal} className="flex items-center gap-1">
                <input type="hidden" name="signalKey" value={item.signalKey} />
                <input type="hidden" name="fingerprint" value={item.fingerprint ?? ""} />
                <input
                  name="reason"
                  required
                  aria-label="Reden waarom dit is afgehandeld"
                  placeholder="reden…"
                  className="w-24 rounded border border-ink-200 bg-white px-1.5 py-0.5 text-[10px] text-ink-700 placeholder-ink-400 focus:border-burgundy focus:outline-none"
                />
                <button type="submit" className="font-ui text-[10px] font-medium uppercase tracking-[0.1em] text-ink-400 hover:text-emerald-700">
                  Klaar
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ----- pure utils ----- */

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat("nl-NL", { hour: "numeric", hour12: false, timeZone: "Europe/Amsterdam" }).format(new Date()));
  if (h < 12) return "Goedemorgen";
  if (h < 18) return "Goedemiddag";
  return "Goedenavond";
}

function hhmm(d: Date | string): string {
  return new Date(d).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function deltaLine(d: ReturnType<typeof weekDelta>): { text: string; tone: "muted" | "emerald" | "red" } {
  if (d.mode === "hidden") return { text: " ", tone: "muted" };
  return { text: d.label, tone: d.mode === "arrow" ? (d.dir === "down" ? "red" : "emerald") : "muted" };
}
