import Link from "next/link";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, escalations, shifts } from "@/lib/db/schema";
import { formatShiftRole } from "@/lib/labels";
import { resolveEscalationFromDashboard, standDownFromDashboard } from "@/app/(admin)/admin/business/_actions";

/**
 * P4b emergency drawer — one open escalation: WHY it's urgent (machine-built reason) +
 * the shift context, then the three moves: fill it (jumps to the "Vul deze dienst" fill
 * drawer, which already ranks replacements), mark it resolved, or stand it down (false
 * alarm / handled outside). resolve/standDown go through the atomic domain fns + audit.
 */
export async function EmergencyDrawer({ escalationId }: { escalationId: string }) {
  const [e] = await db
    .select({
      id: escalations.id,
      shiftId: escalations.shiftId,
      kind: escalations.kind,
      status: escalations.status,
      reason: escalations.reason,
      createdAt: escalations.createdAt,
      startsAt: shifts.startsAt,
      roleNeeded: shifts.roleNeeded,
      companyName: clients.companyName,
    })
    .from(escalations)
    .innerJoin(shifts, eq(shifts.id, escalations.shiftId))
    .leftJoin(clients, eq(clients.id, shifts.clientId))
    .where(eq(escalations.id, escalationId))
    .limit(1);

  if (!e) return <p className="text-sm text-ink-700">Deze spoedsituatie bestaat niet (meer).</p>;
  if (e.status !== "open" && e.status !== "in_progress") {
    return <p className="rounded-lg bg-bg-gray px-3 py-4 text-sm text-ink-700">Deze spoedsituatie is al afgehandeld.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-red-300 bg-red-50 p-4">
        <p className="font-ui text-[10px] font-medium uppercase tracking-[0.16em] text-red-700">Spoed</p>
        <p className="mt-1 font-serif text-base text-ink-900">{e.companyName ?? "Onbekende klant"}</p>
        <p className="mt-0.5 text-sm text-ink-700">
          {formatShiftRole(e.roleNeeded)} · {when(e.startsAt)}
        </p>
        <p className="mt-2 text-sm font-medium text-red-800">{e.reason}</p>
        <p className="mt-1 text-xs text-ink-500">Gemeld {stamp(e.createdAt)}.</p>
      </div>

      {/* Primary move — jump to the fill drawer (ranked replacements live there). */}
      <Link
        href={`/admin/business?drawer=open-shift&shiftId=${e.shiftId}`}
        className="block rounded-lg bg-burgundy px-4 py-3 text-center font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900"
      >
        Vul deze dienst — bekijk vervangers
      </Link>

      {/* Close-out: resolve (handled) or stand down (false alarm). Both take an optional reason. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <form action={resolveEscalationFromDashboard} className="space-y-2 rounded-lg border border-ink-200 bg-white p-3">
          <input type="hidden" name="escalationId" value={e.id} />
          <p className="font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-emerald-700">Opgelost</p>
          <textarea name="resolutionNotes" rows={2} placeholder="bijv. ‘vervanger Sam bevestigd’" className="w-full rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-sm text-ink-900 placeholder-ink-400 focus:border-emerald-400 focus:outline-none" />
          <button type="submit" className="w-full rounded-full bg-emerald-600 px-3.5 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-white hover:bg-emerald-700">
            Markeer opgelost
          </button>
        </form>

        <form action={standDownFromDashboard} className="space-y-2 rounded-lg border border-ink-200 bg-white p-3">
          <input type="hidden" name="escalationId" value={e.id} />
          <p className="font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">Loos alarm</p>
          <textarea name="resolutionNotes" rows={2} placeholder="bijv. ‘chef was toch op tijd’" className="w-full rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-sm text-ink-900 placeholder-ink-400 focus:border-ink-400 focus:outline-none" />
          <button type="submit" className="w-full rounded-full border border-ink-200 bg-white px-3.5 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-ink-600 hover:bg-bg-gray">
            Stand down
          </button>
        </form>
      </div>
    </div>
  );
}

function when(d: Date | string): string {
  return new Date(d).toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
}
function stamp(d: Date | string): string {
  return new Date(d).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
}
