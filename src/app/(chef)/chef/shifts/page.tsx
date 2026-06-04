import { desc, eq } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import {
  chefs,
  clients,
  placements,
  shifts,
} from "@/lib/db/schema";
import { formatShiftRole } from "@/lib/labels";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Mijn shifts" };

export default async function ChefShiftsPage() {
  const session = await requireAuth();
  const chef = await db.query.chefs.findFirst({
    where: eq(chefs.userId, session.user.id),
  });
  if (!chef) return <p>Geen chef-profiel gekoppeld.</p>;

  const rows = await db
    .select({
      placement: placements,
      shift: shifts,
      clientName: clients.companyName,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(clients, eq(clients.id, shifts.clientId))
    .where(eq(placements.chefId, chef.id))
    .orderBy(desc(shifts.startsAt));

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Mijn shifts
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        Alle voorstellen & geschiedenis
      </h1>

      {rows.length === 0 ? (
        <p className="mt-8 rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          Nog geen shifts. Maarten matcht jou aan komende klant-aanvragen.
        </p>
      ) : (
        <ul className="mt-8 space-y-2">
          {rows.map(({ placement, shift, clientName }) => (
            <li key={placement.id}>
              <Link
                href={`/chef/shifts/${placement.id}`}
                className="block rounded-lg border border-ink-200 bg-white p-4 hover:border-burgundy/40 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-serif text-base text-ink-900">
                      {formatShiftRole(shift.roleNeeded)} · {clientName}
                    </h3>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {formatRange(shift.startsAt, shift.endsAt)}
                      {shift.city && ` · ${shift.city}`}
                    </p>
                  </div>
                  <StatusBadge status={placement.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatRange(start: Date, end: Date): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })} · ${s.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}–${e.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "confirmed" || status === "accepted"
      ? "bg-emerald-100 text-emerald-700"
      : status === "proposed"
        ? "bg-amber-100 text-amber-700"
        : status === "completed"
          ? "bg-blue-100 text-blue-700"
          : "bg-bg-gray text-ink-500";
  const labels: Record<string, string> = {
    proposed: "Wacht op jou",
    accepted: "Geaccepteerd",
    confirmed: "Bevestigd",
    rejected: "Afgewezen",
    cancelled: "Geannuleerd",
    completed: "Afgerond",
    no_show: "No-show",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`}
    >
      {labels[status] ?? status}
    </span>
  );
}
