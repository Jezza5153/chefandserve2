import { and, eq, gte, inArray } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { chefs, clients, placements, shifts } from "@/lib/db/schema";
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

  const upcoming = await db
    .select({
      placement: placements,
      shift: shifts,
      chef: chefs,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .where(
      and(
        eq(shifts.clientId, client.id),
        inArray(placements.status, ["accepted", "confirmed"]),
        gte(shifts.startsAt, new Date()),
      ),
    )
    .orderBy(shifts.startsAt)
    .limit(20);

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Welkom bij Chef &amp; Serve
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        {client.companyName}
      </h1>

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-xl text-ink-900">
            Komende shifts ({upcoming.length})
          </h2>
          <Link
            href="/client/request"
            className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
          >
            + Nieuwe aanvraag
          </Link>
        </div>

        {upcoming.length === 0 ? (
          <div className="mt-4 rounded-lg border border-ink-200 bg-white p-8 text-center">
            <p className="font-serif text-lg text-ink-900">
              Geen geplande shifts
            </p>
            <p className="mt-2 text-sm text-ink-500">
              Vraag personeel aan via de knop hierboven, of mail{" "}
              <a
                href={`mailto:${site.email}`}
                className="text-burgundy underline-offset-4 hover:underline"
              >
                {site.email}
              </a>
              .
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {upcoming.map(({ placement, shift, chef }) => (
              <li
                key={placement.id}
                className="rounded-lg border border-ink-200 bg-white p-5"
              >
                <h3 className="font-serif text-lg text-ink-900">
                  {shift.roleNeeded}: {chef.fullName}
                </h3>
                <p className="mt-1 text-sm text-ink-700">
                  {formatRange(shift.startsAt, shift.endsAt)}
                  {shift.location && ` · ${shift.location}`}
                </p>
                <p className="mt-2 text-xs text-ink-500">
                  Status: {placement.status}
                  {chef.yearsExperience &&
                    ` · ${chef.yearsExperience}j ervaring`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <h2 className="font-serif text-xl text-ink-900">Binnenkort</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-700">
          <li>· Direct personeel aanvragen via dit portaal (Phase 6)</li>
          <li>· Chef-profielen bekijken vóór bevestiging</li>
          <li>· Facturen + betalingsstatus (Phase 5)</li>
          <li>· Chefs beoordelen na shifts</li>
        </ul>
      </section>
    </div>
  );
}

function formatRange(start: Date, end: Date): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })}, ${s.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}–${e.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
}
