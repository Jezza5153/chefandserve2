import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, placements, shifts } from "@/lib/db/schema";
import { formatShiftRole } from "@/lib/labels";
import { placementStatusLabel, shiftStatusLabel } from "@/lib/status-labels";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Alle shifts" };

export default async function ClientShiftsPage() {
  const session = await requireAuth();
  const client = await db.query.clients.findFirst({
    where: eq(clients.userId, session.user.id),
  });
  if (!client) return <p>Geen klant-profiel gekoppeld.</p>;

  const rows = await db
    .select({
      placement: placements,
      shift: shifts,
      chef: chefs,
    })
    .from(shifts)
    .leftJoin(placements, eq(placements.shiftId, shifts.id))
    .leftJoin(chefs, eq(chefs.id, placements.chefId))
    .where(eq(shifts.clientId, client.id))
    .orderBy(desc(shifts.startsAt))
    .limit(100);

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Alle shifts
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        Geschiedenis &amp; gepland
      </h1>

      {rows.length === 0 ? (
        <p className="mt-8 rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          Nog geen shifts.
        </p>
      ) : (
        <ul className="mt-8 space-y-2">
          {rows.map((row, i) => (
            <li
              key={`${row.shift.id}-${row.placement?.id ?? i}`}
              className="rounded-lg border border-ink-200 bg-white p-4"
            >
              <h3 className="font-serif text-base text-ink-900">
                {formatShiftRole(row.shift.roleNeeded)}
                {row.chef && ` · ${row.chef.fullName}`}
              </h3>
              <p className="mt-0.5 text-xs text-ink-500">
                {formatRange(row.shift.startsAt, row.shift.endsAt)} ·{" "}
                {row.placement
                  ? placementStatusLabel(row.placement.status)
                  : shiftStatusLabel(row.shift.status)}
              </p>
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
