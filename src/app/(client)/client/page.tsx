/**
 * /client — klant daily home.
 *
 * PR-CHEF-2. Rebuilt as "wat moet ik nu doen?" + this-week schedule.
 *
 * Sections:
 *   - ACTIE NODIG: hours to sign, newly-confirmed chefs (last 7d),
 *     pending portal-submitted requests waiting on Maarten
 *   - DEZE WEEK: chronological list of accepted/confirmed shifts (next 7 days)
 *   - CTA: nieuwe aanvraag + agenda link (PR-CHEF-11 ICS-feed)
 */

import { and, count, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import Link from "next/link";

import { ActionCard, ActionRow } from "@/components/dashboard/ActionCard";
import { db } from "@/lib/db/client";
import {
  chefs,
  clients,
  clientSubmissions,
  placements,
  ratings,
  shiftHours,
  shifts,
} from "@/lib/db/schema";
import { requireAuth } from "@/lib/permissions";
import { site } from "@/lib/site";

export const metadata = { title: "Dashboard" };

export default async function ClientDashboardPage() {
  const session = await requireAuth();
  if (session.user.kind !== "client" && !session.user.roles.includes("super_admin")) {
    return <p>Geen toegang.</p>;
  }

  const client = await db.query.clients.findFirst({
    where: eq(clients.userId, session.user.id),
  });
  if (!client) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-6">
        <h1 className="font-serif text-2xl text-ink-900">Profiel ontbreekt</h1>
        <p className="mt-2 text-sm text-ink-700">
          Er is geen klant-profiel gekoppeld aan dit account. Neem contact op
          met Maarten via{" "}
          <a
            href={`mailto:${site.email}`}
            className="text-burgundy underline-offset-4 hover:underline"
          >
            {site.email}
          </a>
          .
        </p>
      </div>
    );
  }

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 7);
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Hours to sign (submitted)
  const hoursToSign = await db
    .select({
      h: shiftHours,
      chefName: chefs.fullName,
      shiftStart: shifts.startsAt,
      shiftId: shifts.id,
    })
    .from(shiftHours)
    .innerJoin(chefs, eq(chefs.id, shiftHours.chefId))
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .where(
      and(eq(shiftHours.clientId, client.id), eq(shiftHours.status, "submitted")),
    )
    .orderBy(shifts.startsAt);

  // Recently confirmed chefs (last 7d)
  const recentConfirms = await db
    .select({
      p: placements,
      s: shifts,
      chef: chefs,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .where(
      and(
        eq(shifts.clientId, client.id),
        eq(placements.status, "confirmed"),
        gte(placements.confirmedAt, sevenDaysAgo),
      ),
    )
    .orderBy(desc(placements.confirmedAt))
    .limit(5);

  // Pending portal submissions (klant submitted via portal, not yet acted on).
  // PR-AUDIT-1: scoped by owner FK (client_id), not the non-unique companyName.
  const myPending = await db
    .select()
    .from(clientSubmissions)
    .where(
      and(
        eq(clientSubmissions.clientId, client.id),
        eq(clientSubmissions.status, "triaged"),
      ),
    )
    .orderBy(desc(clientSubmissions.createdAt))
    .limit(10);

  // This week's shifts (accepted/confirmed, next 7d)
  const thisWeek = await db
    .select({
      p: placements,
      s: shifts,
      chef: chefs,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .where(
      and(
        eq(shifts.clientId, client.id),
        inArray(placements.status, ["accepted", "confirmed"]),
        gte(shifts.startsAt, startOfToday),
        lte(shifts.startsAt, endOfWeek),
      ),
    )
    .orderBy(shifts.startsAt)
    .limit(20);

  // Approved shifts still awaiting klant feedback (PR-KLANT-5).
  const ratingsPending = await db
    .select({
      shiftId: shifts.id,
      chefName: chefs.fullName,
      shiftStart: shifts.startsAt,
    })
    .from(shiftHours)
    .innerJoin(placements, eq(placements.id, shiftHours.placementId))
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .leftJoin(ratings, eq(ratings.placementId, placements.id))
    .where(
      and(
        eq(shiftHours.clientId, client.id),
        eq(shiftHours.status, "admin_approved"),
        isNull(ratings.id),
      ),
    )
    .orderBy(desc(shifts.startsAt))
    .limit(5);

  // --- Jouw cijfers (read-only insights, PR-K2-6) — all scoped to client.id ---
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [upcoming] = await db
    .select({ n: count() })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .where(
      and(
        eq(shifts.clientId, client.id),
        eq(placements.status, "confirmed"),
        gte(shifts.startsAt, now),
      ),
    );

  const [completed] = await db
    .select({ n: count() })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .where(
      and(eq(shifts.clientId, client.id), eq(placements.status, "completed")),
    );

  // Spend last 30 days = Σ(worked_minutes × client_rate_cents) / 6000 → euros.
  // Rates are snapshotted on the hours row at submit; only approved/exported count.
  const [spendRow] = await db
    .select({
      raw: sql<string>`coalesce(sum(${shiftHours.workedMinutes}::bigint * ${shiftHours.clientRateCents}), 0)`,
    })
    .from(shiftHours)
    .where(
      and(
        eq(shiftHours.clientId, client.id),
        inArray(shiftHours.status, ["admin_approved", "exported"]),
        gte(shiftHours.adminApprovedAt, thirtyDaysAgo),
      ),
    );
  const spendEur = Number(spendRow?.raw ?? 0) / 6000;

  const [topChef] = await db
    .select({ name: chefs.fullName, n: count() })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .where(
      and(
        eq(shifts.clientId, client.id),
        inArray(placements.status, ["confirmed", "completed"]),
      ),
    )
    .groupBy(chefs.id, chefs.fullName)
    .orderBy(desc(count()))
    .limit(1);

  const hasActions =
    hoursToSign.length +
      recentConfirms.length +
      myPending.length +
      ratingsPending.length >
    0;

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Welkom terug
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        {client.companyName}
      </h1>

      {client.onboardingStatus !== "submitted" ? (
        <Link
          href="/client/onboarding"
          className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-burgundy/30 bg-burgundy/5 p-4 transition hover:border-burgundy/50"
        >
          <div>
            <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Actie</p>
            <p className="mt-1 text-sm font-medium text-ink-900">Rond je bedrijfsgegevens af</p>
            <p className="mt-0.5 text-sm text-ink-600">
              {client.onboardingStatus === "in_progress"
                ? "Je hebt een concept opgeslagen — maak het af zodat we de samenwerking kunnen inrichten."
                : "Vul je bedrijfs-, contact- en veiligheidsgegevens in zodat we direct met je aan de slag kunnen."}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-burgundy px-4 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-white">
            Invullen →
          </span>
        </Link>
      ) : null}

      {/* JOUW CIJFERS — read-only insights */}
      <section className="mt-8">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Jouw cijfers
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Komende shifts" value={String(upcoming?.n ?? 0)} />
          <Stat label="Afgeronde shifts" value={String(completed?.n ?? 0)} />
          <Stat
            label="Uren te tekenen"
            value={String(hoursToSign.length)}
            tone={hoursToSign.length > 0 ? "urgent" : "default"}
          />
          <Stat
            label="Besteed (30 dagen)"
            value={
              spendEur > 0
                ? `€ ${spendEur.toLocaleString("nl-NL", { maximumFractionDigits: 0 })}`
                : "—"
            }
          />
        </div>
        {topChef ? (
          <p className="mt-2 text-xs text-ink-500">
            Meest ingezet:{" "}
            <span className="text-ink-800">{topChef.name}</span> ({topChef.n}×)
          </p>
        ) : null}
      </section>

      {/* ACTIE NODIG */}
      <section className="mt-8">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Actie nodig
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {hoursToSign.length > 0 && (
            <ActionCard
              icon="✅"
              title={`${hoursToSign.length} ${hoursToSign.length === 1 ? "uurbriefje wacht" : "uurbriefjes wachten"} op akkoord`}
              tone="urgent"
            >
              {hoursToSign.slice(0, 4).map(({ h, chefName, shiftId, shiftStart }) => (
                <ActionRow
                  key={h.id}
                  label={chefName}
                  meta={formatShiftDateShort(shiftStart)}
                  href={`/client/shifts/${shiftId}`}
                  cta="Controleer →"
                />
              ))}
              {hoursToSign.length > 4 && (
                <p className="px-2 pt-2 text-xs text-ink-500">
                  + {hoursToSign.length - 4} meer
                </p>
              )}
            </ActionCard>
          )}

          {recentConfirms.length > 0 && (
            <ActionCard
              icon="🆕"
              title={`${recentConfirms.length} ${recentConfirms.length === 1 ? "nieuwe chef bevestigd" : "nieuwe chefs bevestigd"}`}
            >
              {recentConfirms.slice(0, 4).map(({ p, s, chef }) => (
                <ActionRow
                  key={p.id}
                  label={`${chef.fullName} · ${s.roleNeeded}`}
                  meta={formatShiftDateShort(s.startsAt)}
                  href={`/client/shifts/${s.id}`}
                  cta="Bekijk →"
                />
              ))}
            </ActionCard>
          )}

          {myPending.length > 0 && (
            <ActionCard
              icon="📝"
              title={`${myPending.length} ${myPending.length === 1 ? "aanvraag wacht" : "aanvragen wachten"} op planning`}
            >
              {myPending.slice(0, 4).map((s) => (
                <ActionRow
                  key={s.id}
                  label={s.roleRequested ?? "Personeel aanvraag"}
                  meta={s.dateNeeded ?? ""}
                />
              ))}
            </ActionCard>
          )}

          {ratingsPending.length > 0 && (
            <ActionCard
              icon="⭐"
              title={`${ratingsPending.length} ${ratingsPending.length === 1 ? "chef wacht" : "chefs wachten"} op je feedback`}
            >
              {ratingsPending.slice(0, 4).map((r) => (
                <ActionRow
                  key={r.shiftId}
                  label={r.chefName}
                  meta={formatShiftDateShort(r.shiftStart)}
                  href={`/client/shifts/${r.shiftId}/rate`}
                  cta="Geef feedback →"
                />
              ))}
            </ActionCard>
          )}

          {!hasActions && (
            <ActionCard icon="✓" title="Geen actie nodig" tone="success">
              <p className="px-2 text-sm text-ink-700">
                Alles is afgehandeld. Vraag nieuwe shifts aan wanneer je ze
                nodig hebt.
              </p>
            </ActionCard>
          )}
        </div>
      </section>

      {/* DEZE WEEK */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Deze week ({thisWeek.length})
          </h2>
          <Link
            href="/client/shifts"
            className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
          >
            Alle shifts →
          </Link>
        </div>

        {thisWeek.length === 0 ? (
          <div className="mt-3 rounded-lg border border-ink-200 bg-white p-6 text-center text-sm text-ink-500">
            Geen shifts deze week.
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {thisWeek.map(({ p, s, chef }) => (
              <li key={p.id}>
                <Link
                  href={`/client/shifts/${s.id}`}
                  className="block rounded border border-ink-200 bg-white p-4 hover:border-burgundy/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-serif text-base text-ink-900">
                        {chef.fullName} · {s.roleNeeded}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {formatShiftDateShort(s.startsAt)} ·{" "}
                        {formatTime(s.startsAt)} – {formatTime(s.endsAt)}
                      </p>
                    </div>
                    <StatusPill status={p.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* CTAs */}
      <section className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/client/request"
          className="rounded-full bg-burgundy px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
        >
          + Nieuwe aanvraag indienen
        </Link>
        <Link
          href="/client/calendar"
          className="rounded-full border border-burgundy/40 bg-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-burgundy hover:bg-burgundy/5"
        >
          Abonneer op agenda
        </Link>
      </section>
    </div>
  );
}

/* --------------- helpers --------------- */

function formatShiftDateShort(d: Date | string): string {
  return new Date(d).toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatTime(d: Date | string): string {
  return new Date(d).toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "urgent";
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        tone === "urgent"
          ? "border-burgundy/30 bg-burgundy/5"
          : "border-ink-200 bg-white"
      }`}
    >
      <p className="font-serif text-2xl text-ink-900">{value}</p>
      <p className="mt-1 font-ui text-[10px] uppercase tracking-[0.15em] text-ink-500">
        {label}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const labels: Record<string, string> = {
    proposed: "Wacht op chef",
    accepted: "Chef komt",
    confirmed: "Bevestigd",
    cancelled: "Geannuleerd",
    completed: "Afgerond",
    rejected: "Afgewezen",
    no_show: "No-show",
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
