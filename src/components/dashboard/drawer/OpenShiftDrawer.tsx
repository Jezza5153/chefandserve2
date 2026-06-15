import Link from "next/link";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, placements, shifts } from "@/lib/db/schema";
import { findMatchesForShift } from "@/lib/domain/matching";
import { formatShiftRole } from "@/lib/labels";
import { proposeFromDashboard, logChefContactFromDashboard } from "@/app/(admin)/admin/business/_actions";

/**
 * "Vul deze dienst" — the lean fill view for an open/critical/underfilled shift.
 * Signal → Context (who/when/how-short + blocker) → Action (Stel voor, reusing
 * proposePlacement) → Confirmation (the action redirects to ?done=). The full,
 * intel-rich match list (travel/marge/pair-memory) stays on the shift-detail page,
 * linked at the bottom — this drawer is the quick one-click fill.
 */
export async function OpenShiftDrawer({ shiftId }: { shiftId: string }) {
  const [shift] = await db
    .select({
      id: shifts.id,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      roleNeeded: shifts.roleNeeded,
      headcount: shifts.headcount,
      city: shifts.city,
      status: shifts.status,
      companyName: clients.companyName,
    })
    .from(shifts)
    .leftJoin(clients, eq(clients.id, shifts.clientId))
    .where(eq(shifts.id, shiftId))
    .limit(1);

  if (!shift) {
    return <p className="text-sm text-ink-700">Deze dienst bestaat niet (meer).</p>;
  }

  const [{ filled }] = await db
    .select({ filled: sql<number>`count(*)::int` })
    .from(placements)
    .where(and(eq(placements.shiftId, shiftId), inArray(placements.status, ["confirmed", "accepted"])));
  const open = Math.max(shift.headcount - filled, 0);

  const matches = await findMatchesForShift(shiftId, { limit: 6 });
  const hoursToStart = Math.round((new Date(shift.startsAt).getTime() - Date.now()) / 3_600_000);
  const startTxt = startLabel(shift.startsAt, shift.endsAt);

  return (
    <div className="space-y-4">
      {/* Header / context */}
      <div className="rounded-lg border border-ink-200 bg-white p-4">
        <p className="font-serif text-base text-ink-900">{shift.companyName ?? "Onbekende klant"}</p>
        <p className="mt-0.5 text-sm text-ink-700">
          {formatShiftRole(shift.roleNeeded)} · {startTxt}
          {shift.city ? ` · ${shift.city}` : ""}
        </p>
        <p className="mt-2 text-sm font-medium text-burgundy">
          {open > 0 ? `Mist ${open} chef${open === 1 ? "" : "s"}` : "Bemand"} · {filled}/{shift.headcount} bemand
          {hoursToStart >= 0 ? ` · start over ${hoursToStart}u` : " · gestart"}
        </p>
        <p className="mt-1 text-xs text-ink-500">Wat gebeurt er nu? Stel een chef voor — die krijgt direct de aanvraag.</p>
      </div>

      {/* Blocker line (why not solved instantly) */}
      {matches.length === 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-medium">Waarom nog niet opgelost?</span> Geen beschikbare match gevonden — verbreed de
          zoektocht, pas het tarief aan, of bekijk de volledige matchlijst.
        </div>
      )}

      {/* Action — ranked candidates with one-click Stel voor */}
      {matches.length > 0 && (
        <ul className="space-y-2">
          {matches.map((m) => (
            <li key={m.chef.id} className="rounded-lg border border-ink-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/business/chefs/${m.chef.id}`}
                      className="font-serif text-sm text-ink-900 hover:text-burgundy hover:underline"
                    >
                      {m.chef.fullName}
                    </Link>
                    <span className={`rounded-full px-2 py-0.5 font-ui text-[10px] font-medium uppercase tracking-wider ${scoreTone(m.score)}`}>
                      {m.score}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {formatShiftRole(m.chef.vakniveau)} · {m.chef.city ?? "—"}
                    {m.chef.yearsExperience ? ` · ${m.chef.yearsExperience}j` : ""}
                  </p>
                  {m.reasons.length > 0 && (
                    <ul className="mt-1.5 flex flex-wrap gap-1">
                      {m.reasons.slice(0, 4).map((r) => (
                        <li key={r} className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">✓ {r}</li>
                      ))}
                    </ul>
                  )}
                  {m.warnings.length > 0 && (
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {m.warnings.slice(0, 3).map((w) => (
                        <li key={w} className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">⚠ {w}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <form action={proposeFromDashboard}>
                  <input type="hidden" name="shiftId" value={shift.id} />
                  <input type="hidden" name="chefId" value={m.chef.id} />
                  <input type="hidden" name="matchScore" value={m.score} />
                  <button
                    type="submit"
                    className="shrink-0 rounded-full bg-burgundy px-3.5 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900"
                  >
                    Stel voor
                  </button>
                </form>
              </div>
              {/* Contact + outcome logging (DASH-5) — feeds the per-shift timeline */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-2">
                {m.chef.phone && (
                  <a
                    href={`https://wa.me/${m.chef.phone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-ink-200 bg-white px-2.5 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-ink-700 hover:border-burgundy hover:text-burgundy"
                  >
                    App
                  </a>
                )}
                {m.chef.email && (
                  <a
                    href={`mailto:${m.chef.email}`}
                    className="rounded-full border border-ink-200 bg-white px-2.5 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-ink-700 hover:border-burgundy hover:text-burgundy"
                  >
                    Mail
                  </a>
                )}
                <form action={logChefContactFromDashboard} className="flex items-center gap-1">
                  <input type="hidden" name="shiftId" value={shift.id} />
                  <input type="hidden" name="chefId" value={m.chef.id} />
                  <input type="hidden" name="channel" value="phone" />
                  <select name="outcome" className="rounded border border-ink-200 bg-white px-1.5 py-1 text-[10px] text-ink-700">
                    <option value="spoken">Gesproken</option>
                    <option value="no_answer">Geen gehoor</option>
                    <option value="callback_requested">Teruggebeld</option>
                    <option value="not_suitable">Niet passend</option>
                    <option value="note_only">Notitie</option>
                  </select>
                  <input name="note" placeholder="notitie" className="w-20 rounded border border-ink-200 bg-white px-1.5 py-1 text-[10px] text-ink-700 placeholder-ink-400" />
                  <button
                    type="submit"
                    className="rounded-full border border-burgundy/40 bg-white px-2.5 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-burgundy hover:bg-burgundy/5"
                  >
                    Log
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Link
          href={`/admin/business/shifts/${shift.id}`}
          className="inline-flex items-center gap-1 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-burgundy hover:underline"
        >
          Volledige matchlijst &amp; dienstdetail →
        </Link>
        <Link
          href={`/admin/business?drawer=timeline&shiftId=${shift.id}`}
          className="inline-flex items-center gap-1 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-ink-600 hover:text-burgundy hover:underline"
        >
          Tijdlijn
        </Link>
        {/* Client-update entry point — the full in-drawer flow (geruststellen / goedkeuring) lands in P4 */}
        <Link
          href={`/admin/business/shifts/${shift.id}`}
          className="inline-flex items-center gap-1 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-ink-600 hover:text-burgundy hover:underline"
        >
          Klant bijwerken
        </Link>
      </div>
    </div>
  );
}

function startLabel(startsAt: Date | string, endsAt: Date | string): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const day = s.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Amsterdam" });
  const t = (d: Date) => d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
  return `${day} ${t(s)}–${t(e)}`;
}

function scoreTone(score: number): string {
  if (score >= 80) return "bg-emerald-100 text-emerald-700";
  if (score >= 60) return "bg-blue-100 text-blue-700";
  if (score >= 40) return "bg-amber-100 text-amber-700";
  return "bg-bg-gray text-ink-500";
}
