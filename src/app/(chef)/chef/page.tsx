import { and, desc, eq, gte, inArray } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import {
  chefs,
  clients,
  placements,
  shifts,
} from "@/lib/db/schema";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Dashboard" };

/**
 * Chef dashboard — first thing a chef sees after login.
 *
 * Sections:
 *   1. Pending proposals (shifts waiting for accept/reject)
 *   2. Upcoming confirmed shifts (next 14 days)
 *   3. Quick links
 */
export default async function ChefDashboardPage() {
  const session = await requireAuth();
  if (session.user.kind !== "chef" && !session.user.roles.includes("super_admin")) {
    return <p>Geen toegang.</p>;
  }

  // Find the chef row linked to this user
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

  /* ----- queries ----- */
  const pending = await db
    .select({
      placement: placements,
      shift: shifts,
      clientName: clients.companyName,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(clients, eq(clients.id, shifts.clientId))
    .where(
      and(
        eq(placements.chefId, chef.id),
        eq(placements.status, "proposed"),
      ),
    )
    .orderBy(shifts.startsAt);

  const upcoming = await db
    .select({
      placement: placements,
      shift: shifts,
      clientName: clients.companyName,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(clients, eq(clients.id, shifts.clientId))
    .where(
      and(
        eq(placements.chefId, chef.id),
        inArray(placements.status, ["accepted", "confirmed"]),
        gte(shifts.startsAt, new Date()),
      ),
    )
    .orderBy(shifts.startsAt)
    .limit(5);

  const recent = await db
    .select({
      placement: placements,
      shift: shifts,
      clientName: clients.companyName,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(clients, eq(clients.id, shifts.clientId))
    .where(eq(placements.chefId, chef.id))
    .orderBy(desc(shifts.startsAt))
    .limit(3);

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Welkom terug
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        {greeting()},{" "}
        {chef.fullName.split(" ")[0]}
      </h1>

      {/* Pending proposals */}
      {pending.length > 0 && (
        <section className="mt-8">
          <h2 className="font-serif text-xl text-ink-900">
            ⏰ Nieuwe voorstellen ({pending.length})
          </h2>
          <p className="mt-1 text-sm text-ink-700">
            Maarten heeft je voorgesteld voor deze shifts. Reageer zo snel
            mogelijk.
          </p>
          <ul className="mt-4 space-y-3">
            {pending.map(({ placement, shift, clientName }) => (
              <li
                key={placement.id}
                className="rounded-lg border-2 border-burgundy/40 bg-burgundy/5 p-5"
              >
                <h3 className="font-serif text-lg text-ink-900">
                  {shift.roleNeeded} bij {clientName}
                </h3>
                <p className="mt-1 text-sm text-ink-700">
                  {formatRange(shift.startsAt, shift.endsAt)}
                  {shift.city && ` · ${shift.city}`}
                </p>
                {shift.chefRateCents && (
                  <p className="mt-1 text-sm text-ink-700">
                    Tarief:{" "}
                    <strong>
                      €{(shift.chefRateCents / 100).toFixed(2)}/uur
                    </strong>
                  </p>
                )}
                {shift.notes && (
                  <p className="mt-2 rounded bg-white px-3 py-2 text-xs italic text-ink-700">
                    Notitie van Maarten: {shift.notes}
                  </p>
                )}
                <div className="mt-4">
                  <Link
                    href={`/chef/shifts/${placement.id}`}
                    className="inline-block rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
                  >
                    Bekijk & reageer →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Upcoming */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-xl text-ink-900">
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
            Geen bevestigde komende shifts.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {upcoming.map(({ placement, shift, clientName }) => (
              <li
                key={placement.id}
                className="rounded-lg border border-ink-200 bg-white p-4"
              >
                <Link
                  href={`/chef/shifts/${placement.id}`}
                  className="block"
                >
                  <h3 className="font-serif text-base text-ink-900 hover:text-burgundy">
                    {shift.roleNeeded} · {clientName}
                  </h3>
                  <p className="mt-1 text-xs text-ink-500">
                    {formatRange(shift.startsAt, shift.endsAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent history */}
      {recent.length > 0 && (
        <section className="mt-10">
          <h2 className="font-serif text-xl text-ink-900">
            Recente shifts
          </h2>
          <ul className="mt-4 space-y-2">
            {recent.map(({ placement, shift, clientName }) => (
              <li
                key={placement.id}
                className="flex items-center justify-between rounded border border-ink-200 bg-white px-4 py-3"
              >
                <div>
                  <p className="font-serif text-sm text-ink-900">
                    {shift.roleNeeded} · {clientName}
                  </p>
                  <p className="text-xs text-ink-500">
                    {formatDate(shift.startsAt)} · {placement.status}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Goedemorgen";
  if (h < 18) return "Goedemiddag";
  return "Goedenavond";
}

function formatRange(start: Date, end: Date): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}, ${s.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}–${e.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
