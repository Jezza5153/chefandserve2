import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, shifts } from "@/lib/db/schema";
import { formatShiftRole } from "@/lib/labels";
import { getShiftTimeline, type TimelineTone } from "@/lib/domain/shift-timeline";

/**
 * "Wat is er gebeurd?" — the human-readable operations history for one shift,
 * newest-first. Two clicks to understand (card → drawer → timeline), per the
 * dashboard contract. Pure read (getShiftTimeline assembles existing data).
 */
export async function TimelineDrawer({ shiftId }: { shiftId: string }) {
  const [shift] = await db
    .select({ roleNeeded: shifts.roleNeeded, startsAt: shifts.startsAt, companyName: clients.companyName })
    .from(shifts)
    .leftJoin(clients, eq(clients.id, shifts.clientId))
    .where(eq(shifts.id, shiftId))
    .limit(1);

  if (!shift) return <p className="text-sm text-ink-700">Deze dienst bestaat niet (meer).</p>;

  const events = await getShiftTimeline(shiftId);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-ink-200 bg-white p-4">
        <p className="font-serif text-base text-ink-900">{shift.companyName ?? "Onbekende klant"}</p>
        <p className="mt-0.5 text-sm text-ink-700">{formatShiftRole(shift.roleNeeded)} · {when(shift.startsAt)}</p>
      </div>

      {events.length === 0 ? (
        <p className="rounded-lg bg-bg-gray px-3 py-4 text-sm text-ink-700">Nog geen geschiedenis voor deze dienst.</p>
      ) : (
        <ol className="relative space-y-3 border-l border-ink-200 pl-4">
          {events.map((e, i) => (
            <li key={i} className="relative">
              <span aria-hidden="true" className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${dot(e.tone)}`} />
              <p className="text-sm text-ink-900">{e.label}</p>
              <p className="text-xs text-ink-500">{stamp(e.at)}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function dot(tone: TimelineTone): string {
  if (tone === "good") return "bg-emerald-500";
  if (tone === "warn") return "bg-burgundy";
  return "bg-ink-300";
}

function when(d: Date | string): string {
  return new Date(d).toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
}
function stamp(d: Date): string {
  return d.toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
}
