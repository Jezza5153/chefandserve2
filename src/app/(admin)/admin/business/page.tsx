import Link from "next/link";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  chefSubmissions,
  chefs,
  clientSubmissions,
  clients,
  placements,
  shifts,
} from "@/lib/db/schema";
import { requireRole } from "@/lib/permissions";

/**
 * Owner / Maarten cockpit.
 *
 * Real-time pulse of the business — what's new in the inbox, how many
 * chefs/clients are active, this week's roster, and what needs Maarten's
 * attention right now (proposed placements awaiting chef response,
 * shifts still open).
 *
 * Access: owner OR super_admin.
 */
export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function BusinessDashboardPage() {
  const session = await requireRole("owner");

  const now = new Date();
  const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Parallel queries — small + fast on Neon
  const [
    [{ newChefSubs }],
    [{ newClientSubs }],
    [{ activeChefs }],
    [{ activeClients }],
    [{ shiftsThisWeek }],
    [{ openShifts }],
    [{ proposedAwaiting }],
    [{ confirmedThisWeek }],
    upcomingShifts,
  ] = await Promise.all([
    db
      .select({
        newChefSubs: sql<number>`count(*)::int`,
      })
      .from(chefSubmissions)
      .where(and(eq(chefSubmissions.status, "new"), gte(chefSubmissions.createdAt, weekAgo))),
    db
      .select({
        newClientSubs: sql<number>`count(*)::int`,
      })
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
      .where(
        and(gte(shifts.startsAt, now), lt(shifts.startsAt, weekFromNow)),
      )
      .orderBy(shifts.startsAt)
      .limit(8),
  ]);

  const inboxCount = newChefSubs + newClientSubs;
  const needsAttention = inboxCount + openShifts + proposedAwaiting;

  return (
    <div className="mx-auto max-w-5xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Operations · {session.user.roles.join(" + ")}
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        {greeting()}
        {session.user.name ? `, ${session.user.name.split(" ")[0]}` : ""}
      </h1>

      {needsAttention === 0 ? (
        <p className="mt-4 text-base text-ink-700">
          Niks wat direct aandacht vraagt. Alles loopt.
        </p>
      ) : (
        <p className="mt-4 text-base text-ink-700">
          <strong className="text-burgundy">{needsAttention}</strong> ding
          {needsAttention === 1 ? "" : "en"} die je aandacht vragen — zie
          hieronder.
        </p>
      )}

      {/* Quick actions */}
      <div className="mt-8 flex flex-wrap gap-3">
        <ActionLink href="/admin/business/inbox" label="Open inbox" />
        <ActionLink href="/admin/business/shifts/new" label="Nieuwe shift" />
        <ActionLink href="/admin/business/chefs" label="Chefs" muted />
        <ActionLink href="/admin/business/clients" label="Klanten" muted />
      </div>

      {/* KPI grid */}
      <div className="mt-10 grid gap-4 md:grid-cols-4">
        <Stat
          label="Nieuwe inbox-items"
          value={inboxCount}
          sub={`${newChefSubs} chefs · ${newClientSubs} klanten`}
          href="/admin/business/inbox"
          highlight={inboxCount > 0}
        />
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
          label="Bevestigd (7d)"
          value={confirmedThisWeek}
          sub="afgelopen week"
        />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-4">
        <Stat label="Actieve chefs" value={activeChefs} href="/admin/business/chefs" />
        <Stat label="Actieve klanten" value={activeClients} href="/admin/business/clients" />
        <Stat label="Shifts deze week" value={shiftsThisWeek} href="/admin/business/shifts" />
        <Stat label="Totaal placements" value={confirmedThisWeek + proposedAwaiting} />
      </div>

      {/* Upcoming roster preview */}
      <section className="mt-12">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-serif text-xl text-ink-900 md:text-2xl">
            Komende 7 dagen
          </h2>
          <Link
            href="/admin/business/shifts"
            className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
          >
            Alle shifts →
          </Link>
        </div>

        {upcomingShifts.length === 0 ? (
          <div className="rounded-lg border border-ink-200 bg-white p-10 text-center">
            <p className="font-serif text-lg text-ink-900">
              Geen shifts ingepland
            </p>
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

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Goedemorgen";
  if (h < 18) return "Goedemiddag";
  return "Goedenavond";
}

function formatWhen(start: Date, end: Date): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })}, ${s.toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  })}–${e.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
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
        <p
          className={`mt-1 text-xs ${
            highlight ? "text-burgundy" : "text-ink-500"
          }`}
        >
          {sub}
        </p>
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
