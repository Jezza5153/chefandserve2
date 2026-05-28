/**
 * /admin/business — Maarten/Gina cockpit.
 *
 * PR-CHEF-2 rebuild: "Actie nodig" comes FIRST, integrations health
 * second, KPIs + upcoming roster preserved below.
 *
 * Access: owner OR super_admin.
 */

import Link from "next/link";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";

import { ActionCard } from "@/components/dashboard/ActionCard";
import { db } from "@/lib/db/client";
import {
  chefSubmissions,
  chefs,
  clientSubmissions,
  clients,
  placements,
  shiftHours,
  shifts,
} from "@/lib/db/schema";
import { getIntegrationHealth } from "@/lib/integrations";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function BusinessDashboardPage() {
  const session = await requireRole("owner");

  const now = new Date();
  const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

  // Parallel queries
  const [
    [{ newChefSubs }],
    [{ newClientSubs }],
    [{ activeChefs }],
    [{ activeClients }],
    [{ shiftsThisWeek }],
    [{ openShifts }],
    [{ proposedAwaiting }],
    [{ confirmedThisWeek }],
    [{ hoursToApprove }],
    [{ hoursMissingFromChef }],
    [{ hoursKlantTimeout }],
    [{ acceptedNotConfirmed }],
    upcomingShifts,
    integrationsHealth,
  ] = await Promise.all([
    db
      .select({ newChefSubs: sql<number>`count(*)::int` })
      .from(chefSubmissions)
      .where(and(eq(chefSubmissions.status, "new"), gte(chefSubmissions.createdAt, weekAgo))),
    db
      .select({ newClientSubs: sql<number>`count(*)::int` })
      .from(clientSubmissions)
      .where(and(eq(clientSubmissions.status, "new"), gte(clientSubmissions.createdAt, weekAgo))),
    db
      .select({ activeChefs: sql<number>`count(*)::int` })
      .from(chefs)
      .where(and(isNull(chefs.deletedAt), eq(chefs.status, "active"))),
    db
      .select({ activeClients: sql<number>`count(*)::int` })
      .from(clients)
      .where(and(isNull(clients.deletedAt), eq(clients.status, "active"))),
    db
      .select({ shiftsThisWeek: sql<number>`count(*)::int` })
      .from(shifts)
      .where(and(gte(shifts.startsAt, now), lt(shifts.startsAt, weekFromNow))),
    db
      .select({ openShifts: sql<number>`count(*)::int` })
      .from(shifts)
      .where(and(eq(shifts.status, "open"), gte(shifts.startsAt, now))),
    db
      .select({ proposedAwaiting: sql<number>`count(*)::int` })
      .from(placements)
      .where(eq(placements.status, "proposed")),
    db
      .select({ confirmedThisWeek: sql<number>`count(*)::int` })
      .from(placements)
      .where(and(eq(placements.status, "confirmed"), gte(placements.createdAt, weekAgo))),
    // HOURS — to approve (client_signed)
    db
      .select({ hoursToApprove: sql<number>`count(*)::int` })
      .from(shiftHours)
      .where(eq(shiftHours.status, "client_signed")),
    // HOURS — completed placements without a submitted shift_hours row (chef forgot)
    db
      .select({ hoursMissingFromChef: sql<number>`count(*)::int` })
      .from(shiftHours)
      .where(eq(shiftHours.status, "draft")),
    // HOURS — klant timeout (submitted > 5d ago)
    db
      .select({ hoursKlantTimeout: sql<number>`count(*)::int` })
      .from(shiftHours)
      .where(
        and(
          eq(shiftHours.status, "submitted"),
          lt(shiftHours.submittedAt, fiveDaysAgo),
        ),
      ),
    // Accepted placements still awaiting admin confirmation
    db
      .select({ acceptedNotConfirmed: sql<number>`count(*)::int` })
      .from(placements)
      .where(eq(placements.status, "accepted")),
    db
      .select({
        id: shifts.id,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        roleNeeded: shifts.roleNeeded,
        status: shifts.status,
        companyName: clients.companyName,
        city: shifts.city,
      })
      .from(shifts)
      .leftJoin(clients, eq(clients.id, shifts.clientId))
      .where(and(gte(shifts.startsAt, now), lt(shifts.startsAt, weekFromNow)))
      .orderBy(shifts.startsAt)
      .limit(8),
    getIntegrationHealth(),
  ]);

  const inboxCount = newChefSubs + newClientSubs;
  const needsAttention =
    hoursToApprove +
    hoursMissingFromChef +
    hoursKlantTimeout +
    acceptedNotConfirmed +
    inboxCount;

  return (
    <div className="mx-auto max-w-5xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Operations · {session.user.roles.join(" + ")}
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        {greeting()}
        {session.user.name ? `, ${session.user.name.split(" ")[0]}` : ""}
      </h1>

      <p className="mt-4 text-base text-ink-700">
        {needsAttention === 0
          ? "Niks wat direct aandacht vraagt. Alles loopt."
          : `${needsAttention} ${needsAttention === 1 ? "ding" : "dingen"} die je aandacht vragen — zie hieronder.`}
      </p>

      {/* ACTIE NODIG */}
      <section className="mt-8">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Actie nodig
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {hoursToApprove > 0 && (
            <ActionCard
              icon="✅"
              title={`${hoursToApprove} ${hoursToApprove === 1 ? "uurbriefje wacht" : "uurbriefjes wachten"} op goedkeuring`}
              tone="urgent"
              ctaLabel="Uren keuren"
              ctaHref="/admin/business/hours?filter=wacht_op_mij"
            />
          )}
          {inboxCount > 0 && (
            <ActionCard
              icon="📨"
              title={`${inboxCount} nieuwe aanmelding${inboxCount === 1 ? "" : "en"}`}
              tone="urgent"
              ctaLabel="Open inbox"
              ctaHref="/admin/business/inbox"
            >
              <p className="px-2 text-xs text-ink-500">
                {newChefSubs} chef{newChefSubs === 1 ? "" : "s"} ·{" "}
                {newClientSubs} klant{newClientSubs === 1 ? "" : "en"}
              </p>
            </ActionCard>
          )}
          {acceptedNotConfirmed > 0 && (
            <ActionCard
              icon="📋"
              title={`${acceptedNotConfirmed} ${acceptedNotConfirmed === 1 ? "shift mist" : "shifts missen"} bevestiging`}
              ctaLabel="Bekijken"
              ctaHref="/admin/business/shifts"
            />
          )}
          {hoursKlantTimeout > 0 && (
            <ActionCard
              icon="⚠️"
              title={`${hoursKlantTimeout} klant${hoursKlantTimeout === 1 ? "" : "en"} heeft 5+ dagen niet getekend`}
              tone="critical"
              ctaLabel="Bekijken"
              ctaHref="/admin/business/hours?filter=wacht_op_klant"
            />
          )}
          {hoursMissingFromChef > 0 && (
            <ActionCard
              icon="⏰"
              title={`${hoursMissingFromChef} chef${hoursMissingFromChef === 1 ? "" : "s"} ${hoursMissingFromChef === 1 ? "heeft" : "hebben"} geen uren ingevuld`}
              ctaLabel="Bekijken"
              ctaHref="/admin/business/hours?filter=wacht_op_chef"
            />
          )}
          {needsAttention === 0 && (
            <ActionCard icon="✓" title="Alles bijgewerkt" tone="success">
              <p className="px-2 text-sm text-ink-700">
                Geen openstaande uren, geen lege inbox, geen vergeten
                bevestigingen.
              </p>
            </ActionCard>
          )}
        </div>
      </section>

      {/* SYSTEEM / INTEGRATIES */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Systeem / integraties
          </h2>
          <Link
            href="/admin/business/integrations"
            className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
          >
            Alle integraties →
          </Link>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <HealthChip
            label="E-mail bezorging"
            value={
              integrationsHealth.emailBouncesLast7d > 0
                ? `${integrationsHealth.emailBouncesLast7d} bounces (7d)`
                : "Geen bounces (7d)"
            }
            tone={integrationsHealth.emailBouncesLast7d > 0 ? "amber" : "green"}
          />
          <HealthChip
            label="Outbox"
            value={
              integrationsHealth.outboxFailed > 0
                ? `${integrationsHealth.outboxFailed} mislukt`
                : `${integrationsHealth.outboxPending} wachtend`
            }
            tone={
              integrationsHealth.outboxFailed > 0
                ? "burgundy"
                : integrationsHealth.outboxPending > 0
                  ? "amber"
                  : "green"
            }
          />
          <HealthChip
            label="Payroll export"
            value="CSV klaar · live API later"
            tone="gray"
          />
        </div>
      </section>

      {/* Quick actions */}
      <div className="mt-10 flex flex-wrap gap-3">
        <ActionLink href="/admin/business/roster" label="Rooster" />
        <ActionLink href="/admin/business/inbox" label="Open inbox" />
        <ActionLink href="/admin/business/shifts/new" label="Nieuwe shift" />
        <ActionLink href="/admin/business/chefs" label="Chefs" muted />
        <ActionLink href="/admin/business/clients" label="Klanten" muted />
        <ActionLink href="/admin/business/hours" label="Uren keuren" muted />
      </div>

      {/* KPI grid */}
      <div className="mt-10 grid gap-4 md:grid-cols-4">
        <Stat label="Actieve chefs" value={activeChefs} href="/admin/business/chefs" />
        <Stat label="Actieve klanten" value={activeClients} href="/admin/business/clients" />
        <Stat label="Shifts deze week" value={shiftsThisWeek} href="/admin/business/shifts" />
        <Stat
          label="Bevestigd (7d)"
          value={confirmedThisWeek}
          sub="afgelopen week"
        />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-4">
        <Stat
          label="Open shifts"
          value={openShifts}
          sub="wachten op chef"
          href="/admin/business/shifts?status=open"
          highlight={openShifts > 0}
        />
        <Stat
          label="Voorgesteld"
          value={proposedAwaiting}
          sub="chef moet reageren"
          href="/admin/business/shifts?status=open"
          highlight={proposedAwaiting > 0}
        />
        <Stat
          label="Uren te keuren"
          value={hoursToApprove}
          sub="wachten op mij"
          href="/admin/business/hours?filter=wacht_op_mij"
          highlight={hoursToApprove > 0}
        />
        <Stat
          label="Uren wachten op klant"
          value={hoursKlantTimeout}
          sub="5+ dagen overtijd"
          href="/admin/business/hours?filter=wacht_op_klant"
          highlight={hoursKlantTimeout > 0}
        />
      </div>

      {/* Upcoming roster preview */}
      <section className="mt-12">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-serif text-xl text-ink-900 md:text-2xl">
            Komende 7 dagen
          </h2>
          <Link
            href="/admin/business/roster"
            className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
          >
            Open rooster →
          </Link>
        </div>

        {upcomingShifts.length === 0 ? (
          <div className="rounded-lg border border-ink-200 bg-white p-10 text-center">
            <p className="font-serif text-lg text-ink-900">Geen shifts ingepland</p>
            <p className="mt-2 text-sm text-ink-500">
              Maak een nieuwe shift aan via{" "}
              <Link
                href="/admin/business/shifts/new"
                className="text-burgundy hover:underline"
              >
                Nieuwe shift
              </Link>
              .
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {upcomingShifts.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-4 rounded border border-ink-200 bg-white px-4 py-3 transition-colors hover:border-burgundy/30"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/business/shifts/${s.id}`}
                    className="font-serif text-sm text-ink-900 hover:text-burgundy"
                  >
                    {s.companyName ?? "Onbekende klant"}{" "}
                    <span className="text-ink-500">· {s.roleNeeded}</span>
                  </Link>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {formatWhen(s.startsAt, s.endsAt)}
                    {s.city ? ` · ${s.city}` : ""}
                  </p>
                </div>
                <ShiftBadge status={s.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* --------------- helpers --------------- */

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Goedemorgen";
  if (h < 18) return "Goedemiddag";
  return "Goedenavond";
}

function formatWhen(start: Date, end: Date): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })}, ${s.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}–${e.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
}

function HealthChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "green" | "amber" | "burgundy" | "gray";
}) {
  const cls =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "amber"
        ? "border-amber-300 bg-amber-50"
        : tone === "burgundy"
          ? "border-burgundy/40 bg-burgundy/5"
          : "border-ink-200 bg-white";
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm text-ink-900">{value}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  href,
  highlight,
}: {
  label: string;
  value: number;
  sub?: string;
  href?: string;
  highlight?: boolean;
}) {
  const inner = (
    <div
      className={`rounded-lg border bg-white p-5 transition-colors ${
        highlight ? "border-burgundy/40 bg-burgundy/5" : "border-ink-200"
      } ${href ? "hover:border-burgundy/40" : ""}`}
    >
      <p className="font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
        {label}
      </p>
      <p className="mt-2 font-serif text-3xl text-ink-900">{value}</p>
      {sub && (
        <p className={`mt-1 text-xs ${highlight ? "text-burgundy" : "text-ink-500"}`}>{sub}</p>
      )}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function ActionLink({
  href,
  label,
  muted,
}: {
  href: string;
  label: string;
  muted?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        muted
          ? "rounded-full border border-ink-200 bg-white px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-700 hover:border-burgundy hover:text-burgundy"
          : "rounded-full bg-burgundy px-5 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900"
      }
    >
      {label}
    </Link>
  );
}

function ShiftBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    request: "bg-blue-100 text-blue-700",
    open: "bg-amber-100 text-amber-800",
    filled: "bg-emerald-100 text-emerald-700",
    completed: "bg-bg-gray text-ink-700",
    cancelled: "bg-red-100 text-red-700",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone[status] ?? "bg-bg-gray text-ink-700"}`}
    >
      {status}
    </span>
  );
}
