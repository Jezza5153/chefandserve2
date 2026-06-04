/**
 * /chef — daily home for chefs.
 *
 * PR-CHEF-2. Rebuilt around "wat moet ik nu doen?" instead of menu-of-features.
 *
 * Sections (in priority order):
 *   1. VANDAAG       — today's confirmed shift(s) with contact + maps + tel:
 *   2. ACTIE NODIG   — pending proposals + hours to log + rejected hours
 *   3. GELD          — approved this month / pending klant / pending admin
 *   4. KOMENDE       — next 4 confirmed shifts
 *
 * Empty states designed (no gray voids).
 */

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import Link from "next/link";

import { ActionCard, ActionRow } from "@/components/dashboard/ActionCard";
import { db } from "@/lib/db/client";
import {
  chefs,
  clients,
  placements,
  shiftHours,
  shifts,
} from "@/lib/db/schema";
import {
  computeChefAmountCents,
  formatEuro,
} from "@/lib/hours-labels";
import { formatShiftRole } from "@/lib/labels";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Dashboard" };

export default async function ChefHomePage() {
  const session = await requireAuth();
  if (session.user.kind !== "chef" && !session.user.roles.includes("super_admin")) {
    return <p>Geen toegang.</p>;
  }

  const chef = await db.query.chefs.findFirst({
    where: eq(chefs.userId, session.user.id),
  });
  if (!chef) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-6">
        <h1 className="font-serif text-2xl text-ink-900">Profiel ontbreekt</h1>
        <p className="mt-2 text-sm text-ink-700">
          Er is geen chef-profiel gekoppeld aan dit account. Neem contact op
          met Maarten of het kantoor.
        </p>
      </div>
    );
  }

  /* ---------------- queries ---------------- */
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 14);

  // Today's confirmed shifts
  const todayShifts = await db
    .select({ p: placements, s: shifts, clientName: clients.companyName, clientPhone: clients.phone })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(clients, eq(clients.id, shifts.clientId))
    .where(
      and(
        eq(placements.chefId, chef.id),
        inArray(placements.status, ["confirmed", "accepted"]),
        gte(shifts.startsAt, startOfToday),
        lte(shifts.startsAt, startOfTomorrow),
      ),
    )
    .orderBy(shifts.startsAt);

  // Pending proposals
  const pendingProposals = await db
    .select({ p: placements, s: shifts, clientName: clients.companyName })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(clients, eq(clients.id, shifts.clientId))
    .where(and(eq(placements.chefId, chef.id), eq(placements.status, "proposed")))
    .orderBy(shifts.startsAt);

  // Hours to log
  const hoursToLog = await db
    .select({ h: shiftHours, s: shifts, clientName: clients.companyName })
    .from(shiftHours)
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .where(and(eq(shiftHours.chefId, chef.id), eq(shiftHours.status, "draft")))
    .orderBy(shifts.startsAt);

  // Hours rejected (need attention)
  const hoursRejected = await db
    .select({ h: shiftHours, s: shifts, clientName: clients.companyName })
    .from(shiftHours)
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .where(
      and(
        eq(shiftHours.chefId, chef.id),
        inArray(shiftHours.status, ["client_rejected", "admin_rejected"]),
      ),
    )
    .orderBy(shifts.startsAt);

  // GELD — money buckets (PR-CHEF-3). Human framing: te ontvangen / in controle / afgekeurd.
  // "Te ontvangen" is all-time on purpose — a month filter made this read €0 / "0 shifts"
  // even for an active chef.
  const approved = await db
    .select({
      workedMinutes: shiftHours.workedMinutes,
      chefRateCents: shiftHours.chefRateCents,
    })
    .from(shiftHours)
    .where(
      and(
        eq(shiftHours.chefId, chef.id),
        inArray(shiftHours.status, ["admin_approved", "exported"]),
      ),
    );
  const approvedCents = approved.reduce(
    (sum, r) => sum + computeChefAmountCents(r.workedMinutes, r.chefRateCents),
    0,
  );

  // "In controle" — submitted (wacht op klant) + client_signed (wacht op Chef & Serve).
  const inControle = await db
    .select({
      workedMinutes: shiftHours.workedMinutes,
      chefRateCents: shiftHours.chefRateCents,
    })
    .from(shiftHours)
    .where(
      and(
        eq(shiftHours.chefId, chef.id),
        inArray(shiftHours.status, ["submitted", "client_signed"]),
      ),
    );
  const inControleCents = inControle.reduce(
    (sum, r) => sum + computeChefAmountCents(r.workedMinutes, r.chefRateCents),
    0,
  );

  // "Afgekeurd" — reuse hoursRejected (client_rejected + admin_rejected).
  const rejectedCents = hoursRejected.reduce(
    (sum, { h }) => sum + computeChefAmountCents(h.workedMinutes, h.chefRateCents),
    0,
  );

  // Next 4 confirmed shifts (incl. today)
  const upcoming = await db
    .select({ p: placements, s: shifts, clientName: clients.companyName })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(clients, eq(clients.id, shifts.clientId))
    .where(
      and(
        eq(placements.chefId, chef.id),
        inArray(placements.status, ["accepted", "confirmed"]),
        gte(shifts.startsAt, startOfToday),
      ),
    )
    .orderBy(shifts.startsAt)
    .limit(5);

  // Next shift countdown (anything within 14 days)
  const nextShift = upcoming.find(
    (u) => new Date(u.s.startsAt).getTime() > now.getTime() && new Date(u.s.startsAt) <= horizon,
  );

  /* ---------------- render ---------------- */
  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        {greeting()}
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        Hallo {chef.fullName.split(" ")[0]}
      </h1>

      {/* VANDAAG */}
      {todayShifts.length > 0 && (
        <section className="mt-8">
          <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Vandaag
          </h2>
          <ul className="mt-3 space-y-3">
            {todayShifts.map(({ p, s, clientName, clientPhone }) => (
              <li
                key={p.id}
                className="rounded-lg border-2 border-burgundy/40 bg-burgundy/5 p-5"
              >
                <h3 className="font-serif text-xl text-ink-900">
                  {clientName}
                </h3>
                <p className="mt-1 text-sm text-ink-700">
                  {formatTime(s.startsAt)} – {formatTime(s.endsAt)} ·{" "}
                  {formatShiftRole(s.roleNeeded)}
                </p>
                {s.location ? (
                  <p className="mt-1 text-xs text-ink-500">{s.location}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {clientPhone ? (
                    <a
                      href={`tel:${clientPhone.replace(/[^+\d]/g, "")}`}
                      className="rounded-full bg-burgundy px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900"
                    >
                      Bel klant
                    </a>
                  ) : null}
                  {s.location ? (
                    <a
                      href={`https://maps.google.com/?q=${encodeURIComponent(s.location)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full border border-burgundy/40 bg-white px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5"
                    >
                      Route openen
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ACTIE NODIG */}
      <section className="mt-10">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Actie nodig
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {pendingProposals.length > 0 ? (
            <ActionCard
              icon="⏰"
              title={`${pendingProposals.length} shift ${pendingProposals.length === 1 ? "voorstel" : "voorstellen"}`}
              tone="urgent"
            >
              {pendingProposals.slice(0, 3).map(({ p, s, clientName }) => (
                <ActionRow
                  key={p.id}
                  label={`${clientName} · ${formatShiftRole(s.roleNeeded)}`}
                  meta={formatShiftDateShort(s.startsAt)}
                  href={`/chef/shifts/${p.id}`}
                  cta="Bekijk →"
                />
              ))}
            </ActionCard>
          ) : null}

          {hoursToLog.length > 0 ? (
            <ActionCard
              icon="📝"
              title={`${hoursToLog.length} ${hoursToLog.length === 1 ? "uurbriefje" : "uurbriefjes"} invullen`}
              tone="urgent"
            >
              {hoursToLog.slice(0, 3).map(({ h, s, clientName }) => (
                <ActionRow
                  key={h.id}
                  label={`${clientName} · ${formatShiftRole(s.roleNeeded)}`}
                  meta={formatShiftDateShort(s.startsAt)}
                  href={`/chef/hours/${h.placementId}`}
                  cta="Vul in →"
                />
              ))}
              {hoursToLog.length > 3 ? (
                <p className="px-2 pt-2 text-xs text-ink-500">
                  + {hoursToLog.length - 3} meer
                </p>
              ) : null}
            </ActionCard>
          ) : null}

          {hoursRejected.length > 0 ? (
            <ActionCard
              icon="⚠️"
              title={`${hoursRejected.length} ${hoursRejected.length === 1 ? "uurbriefje afgekeurd" : "uurbriefjes afgekeurd"}`}
              tone="critical"
            >
              {hoursRejected.slice(0, 3).map(({ h, s, clientName }) => (
                <ActionRow
                  key={h.id}
                  label={`${clientName} · ${formatShiftRole(s.roleNeeded)}`}
                  meta={formatShiftDateShort(s.startsAt)}
                  href={`/chef/hours/${h.placementId}`}
                  cta="Pas aan →"
                />
              ))}
            </ActionCard>
          ) : null}

          {pendingProposals.length === 0 && hoursToLog.length === 0 && hoursRejected.length === 0 ? (
            <ActionCard icon="✓" title="Geen actie nodig" tone="success">
              <p className="px-2 text-sm text-ink-700">
                Alles is afgehandeld. Veel plezier op je shift.
              </p>
            </ActionCard>
          ) : null}
        </div>
      </section>

      {/* GELD */}
      <section className="mt-10">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Geld
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <MoneyStat
            tone="primary"
            label="Te ontvangen"
            value={formatEuro(approvedCents)}
            note="Goedgekeurd, klaar voor betaling"
          />
          <MoneyStat
            label="In controle"
            value={formatEuro(inControleCents)}
            note="Wacht op klant of Chef & Serve"
          />
          <MoneyStat
            tone={rejectedCents > 0 ? "danger" : "neutral"}
            label="Afgekeurd"
            value={formatEuro(rejectedCents)}
            note={rejectedCents > 0 ? "Actie nodig — pas je uren aan" : "Niets afgekeurd"}
          />
        </div>
        <p className="mt-2 text-xs text-ink-500">
          Uren worden pas uitbetaald nadat klant én Chef &amp; Serve akkoord zijn.
        </p>
      </section>

      {/* Next shift countdown (if applicable) */}
      {nextShift && todayShifts.length === 0 ? (
        <section className="mt-10">
          <div className="rounded-lg border border-burgundy/30 bg-burgundy/5 p-5">
            <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
              Volgende shift
            </p>
            <p className="mt-2 font-serif text-xl text-ink-900">
              {nextShift.clientName} · {formatShiftRole(nextShift.s.roleNeeded)}
            </p>
            <p className="mt-1 text-sm text-ink-700">
              {countdownLabel(nextShift.s.startsAt)} ·{" "}
              {new Date(nextShift.s.startsAt).toLocaleDateString("nl-NL", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
          </div>
        </section>
      ) : null}

      {/* KOMENDE */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Komende shifts ({upcoming.length})
          </h2>
          <Link
            href="/chef/shifts"
            className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
          >
            Alle shifts →
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="mt-3 rounded-lg border border-ink-200 bg-white p-6 text-center text-sm text-ink-500">
            Geen bevestigde shifts. Maarten matcht je aan komende aanvragen.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {upcoming.map(({ p, s, clientName }) => (
              <li
                key={p.id}
                className="rounded border border-ink-200 bg-white p-4"
              >
                <Link href={`/chef/shifts/${p.id}`} className="block">
                  <p className="font-serif text-base text-ink-900 hover:text-burgundy">
                    {clientName} · {formatShiftRole(s.roleNeeded)}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {formatShiftDateShort(s.startsAt)} · {formatTime(s.startsAt)} – {formatTime(s.endsAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ------------------- helpers ------------------- */

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Goedemorgen";
  if (h < 18) return "Goedemiddag";
  return "Goedenavond";
}

function formatTime(d: Date | string): string {
  return new Date(d).toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShiftDateShort(d: Date | string): string {
  return new Date(d).toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function countdownLabel(d: Date | string): string {
  const ms = new Date(d).getTime() - Date.now();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  if (days <= 0) return `over ${hours} uur`;
  if (days === 1) return "morgen";
  if (days < 7) return `over ${days} dagen`;
  return `over ${days} dagen`;
}

function MoneyStat({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "primary" | "neutral" | "danger";
}) {
  const box =
    tone === "primary"
      ? "border-burgundy/30 bg-burgundy/5"
      : tone === "danger"
        ? "border-red-200 bg-red-50/50"
        : "border-ink-200 bg-white";
  const num =
    tone === "primary"
      ? "text-burgundy"
      : tone === "danger"
        ? "text-red-700"
        : "text-ink-900";
  return (
    <div className={`rounded-lg border p-4 ${box}`}>
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
        {label}
      </p>
      <p className={`mt-1 font-serif text-2xl tabular-nums ${num}`}>{value}</p>
      <p className="mt-1 text-xs text-ink-500">{note}</p>
    </div>
  );
}
