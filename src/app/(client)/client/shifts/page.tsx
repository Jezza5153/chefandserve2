/**
 * /client/shifts — the klant's full shift history + planned, newest first.
 *
 * One row per shift (the most-progressed NON-draft placement). Draft concepts
 * never appear, and every status goes through getClientShiftLabel — no raw
 * backend status or role enum reaches the UI (hard rule). Each row links to the
 * shift hub for the full picture.
 */
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { chefs, clients, placements, shiftHours, shifts } from "@/lib/db/schema";
import { getClientShiftLabel } from "@/lib/client-shift-labels";
import { formatChefRole } from "@/lib/labels";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Alle shifts" };
export const dynamic = "force-dynamic";

const RANK = ["proposed", "accepted", "confirmed", "completed", "cancelled", "rejected", "no_show"];
const rank = (s: string) => RANK.indexOf(s);

function formatRange(start: Date | string, end: Date | string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })} · ${s.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}–${e.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
}

export default async function ClientShiftsPage() {
  const session = await requireAuth();
  const client = await db.query.clients.findFirst({
    where: eq(clients.userId, session.user.id),
  });
  if (!client) return <p>Geen klant-profiel gekoppeld.</p>;

  const shiftRows = await db
    .select({
      id: shifts.id,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      roleNeeded: shifts.roleNeeded,
      status: shifts.status,
    })
    .from(shifts)
    .where(eq(shifts.clientId, client.id))
    .orderBy(desc(shifts.startsAt))
    .limit(100);
  const shiftIds = shiftRows.map((s) => s.id);

  const plRows = shiftIds.length
    ? await db
        .select({
          shiftId: placements.shiftId,
          status: placements.status,
          chefName: chefs.fullName,
        })
        .from(placements)
        .innerJoin(chefs, eq(chefs.id, placements.chefId))
        .where(and(inArray(placements.shiftId, shiftIds), ne(placements.status, "draft")))
    : [];
  const bestByShift = new Map<string, (typeof plRows)[number]>();
  for (const p of plRows) {
    const cur = bestByShift.get(p.shiftId);
    if (!cur || rank(p.status) > rank(cur.status)) bestByShift.set(p.shiftId, p);
  }

  const hoursRows = shiftIds.length
    ? await db
        .select({ shiftId: shiftHours.shiftId, status: shiftHours.status })
        .from(shiftHours)
        .where(inArray(shiftHours.shiftId, shiftIds))
    : [];
  const hoursByShift = new Map(hoursRows.map((h) => [h.shiftId, h.status]));

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Alle shifts</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        Geschiedenis &amp; gepland
      </h1>

      {shiftRows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-ink-200 bg-white p-8 text-center">
          <p className="text-sm text-ink-500">Nog geen shifts.</p>
          <Link
            href="/client/request"
            className="mt-3 inline-block rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
          >
            + Vraag een dienst aan
          </Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-2">
          {shiftRows.map((s) => {
            const best = bestByShift.get(s.id);
            const label = getClientShiftLabel({
              shiftStatus: s.status,
              hasPlacement: Boolean(best),
              placementStatus: best?.status ?? null,
              hoursStatus: hoursByShift.get(s.id) ?? null,
            });
            return (
              <li key={s.id}>
                <Link
                  href={`/client/shifts/${s.id}`}
                  className="block rounded-lg border border-ink-200 bg-white p-4 hover:border-burgundy/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-serif text-base text-ink-900">
                      {formatChefRole(s.roleNeeded)}
                      {best?.chefName ? ` · ${best.chefName}` : ""}
                    </h3>
                    <span className="shrink-0 font-ui text-[11px] font-medium text-burgundy">
                      {label.humanStatus}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">{formatRange(s.startsAt, s.endsAt)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
