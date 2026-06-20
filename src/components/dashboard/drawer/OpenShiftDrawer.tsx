import Link from "next/link";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients, placements, shifts } from "@/lib/db/schema";
import { findMatchesForShift } from "@/lib/domain/matching";
import { assertChefsDeployable, type DeployabilityGate } from "@/lib/domain/chef-deployability-gate";
import { estimateTravel, estimateMargin, eur, type MarginEstimate, type TransportMode } from "@/lib/domain/travel";
import { summarizeFillBlockers } from "@/lib/domain/fill-blockers";
import { env } from "@/lib/env";
import { aiEnabled } from "@/lib/ai/config";
import { formatShiftRole } from "@/lib/labels";
import { OverrideDeployabilityBlock } from "@/components/OverrideDeployabilityBlock";
import { AiQuickAsk } from "@/components/ai/AiQuickAsk";
import { proposeFromDashboard, logChefContactFromDashboard } from "@/app/(admin)/admin/business/_actions";

/**
 * "Vul deze dienst" — the lean fill view for an open/critical/underfilled shift.
 * Signal → Context (who/when/how-short + blocker) → Action (Stel voor, reusing
 * proposePlacement) → Confirmation (the action redirects to ?done=). The full,
 * intel-rich match list (travel/pair-memory) stays on the shift-detail page, linked at
 * the bottom — this drawer is the quick one-click fill. P3c optionally surfaces per-
 * candidate marge here too (MATCHING_MARGIN_GUARD_ENABLED) so the financial signal is at
 * the fill moment.
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
      // P3c margin guard inputs (only read when MATCHING_MARGIN_GUARD_ENABLED).
      clientRateCents: shifts.clientRateCents,
      chefRateCents: shifts.chefRateCents,
      latitude: shifts.latitude,
      longitude: shifts.longitude,
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
  // P3a: per-candidate deployability (flag-gated, one batched read). When off the Map is
  // empty → every chef renders the normal one-click propose, behaviour unchanged.
  const gateByChef: Map<string, DeployabilityGate> =
    env.COMPLIANCE_HARDGATE_ENABLED === "true"
      ? await assertChefsDeployable(matches.map((m) => m.chef.id))
      : new Map();
  const hoursToStart = Math.round((new Date(shift.startsAt).getTime() - Date.now()) / 3_600_000);
  const startTxt = startLabel(shift.startsAt, shift.endsAt);

  // P3c margin guard (flag-gated): per-candidate marge (revenue − loon − reis) surfaced
  // at the choice moment, so the fill-drawer carries the financial signal the shift-detail
  // page already shows. Pure compute on already-loaded data (chef rate/lat/lng live on
  // m.chef) — no extra query. Off → empty Map → drawer unchanged + no compute.
  const marginByChef = new Map<string, MarginEstimate>();
  if (env.MATCHING_MARGIN_GUARD_ENABLED === "true") {
    const shiftCoords =
      shift.latitude && shift.longitude ? { lat: Number(shift.latitude), lng: Number(shift.longitude) } : null;
    const shiftHours = (new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime()) / 3_600_000;
    for (const m of matches) {
      const c = m.chef;
      const travelCents =
        shiftCoords && c.latitude && c.longitude
          ? estimateTravel({
              from: { lat: Number(c.latitude), lng: Number(c.longitude) },
              to: shiftCoords,
              mode: (c.transportMode as TransportMode | null) ?? "none",
            }).costCents
          : 0;
      marginByChef.set(
        c.id,
        estimateMargin({
          clientRateCents: shift.clientRateCents,
          chefRateCents: c.hourlyRateMinCents ?? shift.chefRateCents,
          hours: shiftHours,
          travelCents,
        }),
      );
    }
  }

  // P3 blocker explanation: WHY is a shift WITH candidates still hard to fill? Aggregates
  // the gate signals the drawer already computed (P3a compliance · P3c margin) + the
  // matching travel/klant-block warnings. Rich when the matching flags are on; empty when
  // the candidates are simply fine (then the shift is just open, no blocker line).
  const fillBlockers = summarizeFillBlockers(
    matches.map((m) => ({
      complianceBlocked: gateByChef.get(m.chef.id)?.deployable === false,
      marginNegative: marginByChef.get(m.chef.id)?.tone === "negative",
      outOfRadius: m.warnings.some((w) => w.startsWith("Buiten reisafstand")),
      klantBlocked: m.warnings.includes("door klant geblokkeerd"),
    })),
  );

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
        {/* P5a: shift-context AI quick-asks → hand the prompt to the assistant (it answers
            via the confirm-gated tools: shortlist, belvolgorde, klantbericht). */}
        {aiEnabled() && (
          <AiQuickAsk
            items={[
              { label: "Wie kan dit?", prompt: aiCtx("Wie kan deze dienst doen", shift) + " Geef een korte shortlist met redenen en een aanrader." },
              { label: "Waarom moeilijk?", prompt: aiCtx("Waarom is deze dienst moeilijk te vullen", shift) },
              { label: "Maak belvolgorde", prompt: aiCtx("Maak een belvolgorde van chefs voor deze dienst", shift) },
              { label: "Bericht aan klant", prompt: aiCtx("Stel een kort, geruststellend bericht op aan de klant over deze dienst — we zijn ermee bezig", shift) },
            ]}
          />
        )}
      </div>

      {/* Blocker line (why not solved instantly) — zero matches, OR candidates exist but
          the gates flag why it's hard (compliance / klant-block / reisafstand / marge). */}
      {matches.length === 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-medium">Waarom nog niet opgelost?</span> Geen beschikbare match gevonden — verbreed de
          zoektocht, pas het tarief aan, of bekijk de volledige matchlijst.
        </div>
      ) : fillBlockers.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-medium">Waarom moeilijk te vullen?</span>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {fillBlockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}

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
                  {/* P3c: marge at the choice moment (negative = red guard). */}
                  {marginByChef.has(m.chef.id) && (
                    <p className="mt-1">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${marginTone(marginByChef.get(m.chef.id)!.tone)}`}>
                        marge {eur(marginByChef.get(m.chef.id)!.marginCents)}
                        {marginByChef.get(m.chef.id)!.tone === "negative"
                          ? " — negatief"
                          : marginByChef.get(m.chef.id)!.tone === "low"
                            ? " (laag)"
                            : ""}
                      </span>
                    </p>
                  )}
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
                {/* Blocked (P3a) or negative-margin (P3c-2) chefs lose the one-click button →
                    the matching override-with-reason panel renders below. */}
                {gateByChef.get(m.chef.id)?.deployable === false ||
                marginByChef.get(m.chef.id)?.tone === "negative" ? null : (
                  <form action={proposeFromDashboard}>
                    <input type="hidden" name="shiftId" value={shift.id} />
                    <input type="hidden" name="chefId" value={m.chef.id} />
                    <input type="hidden" name="matchScore" value={m.score} />
                    <button
                      type="submit"
                      className="shrink-0 rounded-full bg-burgundy px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900"
                    >
                      Stel voor
                    </button>
                  </form>
                )}
              </div>

              {/* P3a compliance hard-gate: blocked chef → red blocker chips + override-with-reason. */}
              {gateByChef.get(m.chef.id)?.deployable === false && (
                <div className="mt-2">
                  <OverrideDeployabilityBlock
                    action={proposeFromDashboard}
                    hidden={{ shiftId: shift.id, chefId: m.chef.id, matchScore: m.score }}
                    blockers={gateByChef.get(m.chef.id)!.blockers}
                    cta="Stel voor"
                  />
                </div>
              )}

              {/* P3c-2 margin guard: negative-margin candidate (not compliance-blocked) → justify
                  the deliberate loss with a reason (audited placements.margin_override). */}
              {gateByChef.get(m.chef.id)?.deployable !== false &&
                marginByChef.get(m.chef.id)?.tone === "negative" && (
                  <div className="mt-2">
                    <OverrideDeployabilityBlock
                      action={proposeFromDashboard}
                      hidden={{ shiftId: shift.id, chefId: m.chef.id, matchScore: m.score }}
                      blockers={["marge " + eur(marginByChef.get(m.chef.id)!.marginCents)]}
                      cta="Stel voor"
                      heading="Marge negatief — toch voorstellen met reden"
                      reasonField="marginOverrideReason"
                      placeholder="Bijv. ‘sleutelklant, accepteren we dit deze keer’"
                    />
                  </div>
                )}
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
                  <select name="outcome" aria-label="Contactresultaat" className="rounded border border-ink-200 bg-white px-1.5 py-1 text-[10px] text-ink-700">
                    <option value="spoken">Gesproken</option>
                    <option value="no_answer">Geen gehoor</option>
                    <option value="callback_requested">Teruggebeld</option>
                    <option value="not_suitable">Niet passend</option>
                    <option value="note_only">Notitie</option>
                  </select>
                  <input name="note" aria-label="Notitie bij contact" placeholder="notitie" className="w-20 rounded border border-ink-200 bg-white px-1.5 py-1 text-[10px] text-ink-700 placeholder-ink-400" />
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

/** P5a: a shift-context AI prompt — klant · role · when · city · id, so the assistant
 *  routes to the right shift (shifts.find / shifts.suggest_chefs / email.send … all
 *  stay confirm-gated). */
function aiCtx(
  verb: string,
  shift: { id: string; roleNeeded: string; companyName: string | null; startsAt: Date | string; endsAt: Date | string; city: string | null },
): string {
  const when = startLabel(shift.startsAt, shift.endsAt);
  const city = shift.city ? ` in ${shift.city}` : "";
  return `${verb}: ${formatShiftRole(shift.roleNeeded)} bij ${shift.companyName ?? "de klant"} op ${when}${city}? (dienst-id: ${shift.id})`;
}

function marginTone(tone: MarginEstimate["tone"]): string {
  if (tone === "negative") return "bg-red-100 text-red-700";
  if (tone === "low") return "bg-amber-100 text-amber-800";
  return "bg-emerald-100 text-emerald-700";
}

function scoreTone(score: number): string {
  if (score >= 80) return "bg-emerald-100 text-emerald-700";
  if (score >= 60) return "bg-blue-100 text-blue-700";
  if (score >= 40) return "bg-amber-100 text-amber-700";
  return "bg-bg-gray text-ink-500";
}
