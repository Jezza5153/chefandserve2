/**
 * /chef/earnings — PR-INTEL. The chef's own verdiensten + werkpatronen, reusing
 * the same getChefPatterns intel the operator sees (their chef rate = their pay).
 * Read-only; auth IS the lookup (session.user.id → chefs.userId).
 */
import { eq } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import { getChefForecastEarnings } from "@/lib/domain/chef-forecast";
import { getChefPatterns } from "@/lib/domain/intel";
import {
  getChefPaymentStatus,
  getChefVacationEstimate,
} from "@/lib/domain/chef-payments";
import { formatEuro, formatWorkedMinutes } from "@/lib/hours-labels";
import { formatChefRole } from "@/lib/labels";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Verdiensten" };
export const dynamic = "force-dynamic";

/** "€X" when the rate is pinned, "€X – €Y" when only the chef's band is known. */
function forecastAmount(minCents: number, maxCents: number): string {
  return maxCents > minCents
    ? `${formatEuro(minCents)} – ${formatEuro(maxCents)}`
    : formatEuro(minCents);
}

const FULL_DAY: Record<string, string> = {
  Ma: "maandag",
  Di: "dinsdag",
  Wo: "woensdag",
  Do: "donderdag",
  Vr: "vrijdag",
  Za: "zaterdag",
  Zo: "zondag",
};
const LABEL = "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy";

export default async function ChefEarningsPage() {
  const session = await requireAuth("/chef/earnings");
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.userId, session.user.id) });
  if (!chef) {
    return (
      <p className="rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
        Geen chef-profiel gekoppeld aan dit account.
      </p>
    );
  }

  const patterns = await getChefPatterns(chef.id);
  const forecast = await getChefForecastEarnings(chef.id);
  const payments = await getChefPaymentStatus(chef.id);
  const vacation = await getChefVacationEstimate(chef.id);
  const maxDay = Math.max(1, ...patterns.preferredDays.map((d) => d.count));
  const hasData = patterns.preferredDays.some((d) => d.count > 0);
  const dayFmt = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "numeric",
    month: "short",
  });

  return (
    <div>
      <p className={LABEL}>Verdiensten</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">Verdiensten &amp; patronen</h1>
      <p className="mt-3 max-w-prose text-sm text-ink-700">
        Wat je hebt verdiend uit goedgekeurde uren, en je werkpatroon. Vragen over
        een uitbetaling? Bel of mail het kantoor.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Totaal verdiend</p>
          <p className="mt-1 text-3xl font-semibold text-ink-900">
            {formatEuro(patterns.totalEarnedCents)}
          </p>
          <p className="text-xs text-ink-500">uit alle goedgekeurde uren</p>
        </div>
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Laatste 30 dagen</p>
          <p className="mt-1 text-3xl font-semibold text-ink-900">
            {formatEuro(patterns.earned30dCents)}
          </p>
          <p className="text-xs text-ink-500">recent goedgekeurd</p>
        </div>
      </div>

      {/* Forward view — verwachte verdiensten uit bevestigde shifts. */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
            Verwacht · komende {forecast.daysAhead} dagen
          </p>
          {forecast.totalShifts > 0 ? (
            <p className="text-2xl font-semibold text-ink-900">
              {forecastAmount(forecast.totalMinCents, forecast.totalMaxCents)}
            </p>
          ) : null}
        </div>
        {forecast.totalShifts === 0 ? (
          <p className="mt-2 text-sm text-ink-500">
            Nog geen bevestigde shifts ingepland. Zodra je ingeroosterd bent, zie je
            hier wat je verwacht te verdienen.
          </p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-ink-100">
              {forecast.weeks.map((w) => (
                <li
                  key={w.weekStart}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="text-ink-700">
                    {w.label}{" "}
                    <span className="text-ink-400">
                      · {w.shifts} {w.shifts === 1 ? "dienst" : "diensten"}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-ink-900">
                    {forecastAmount(w.minCents, w.maxCents)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-500">
              Schatting op basis van je bevestigde shifts. Klanten kunnen nog
              annuleren en pauzes zijn hier nog niet afgetrokken — het echte bedrag
              kan dus lager uitvallen.
            </p>
          </>
        )}
      </section>

      {/* CHEF-PR9a: "Wanneer word ik betaald?" — payout pipeline over the hours chain. */}
      {payments.buckets.length > 0 ? (
        <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className={LABEL}>Wanneer word ik betaald?</p>
            {payments.inFlightCents > 0 ? (
              <p className="text-sm text-ink-500">
                Onderweg naar jou:{" "}
                <strong className="text-ink-900">{formatEuro(payments.inFlightCents)}</strong>
              </p>
            ) : null}
          </div>
          <div className="mt-3 space-y-3">
            {payments.buckets.map((b) => (
              <div key={b.stage} className="rounded-md border border-ink-100 bg-bg-gray/40 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-ink-900">
                    {b.label}{" "}
                    <span className="text-ink-400">
                      · {b.count} {b.count === 1 ? "dienst" : "diensten"}
                    </span>
                  </p>
                  <span className="font-mono text-sm text-ink-900">{formatEuro(b.amountCents)}</span>
                </div>
                <p className="mt-1 text-xs text-ink-500">{b.nextStep}</p>
                <ul className="mt-2 divide-y divide-ink-100">
                  {b.lines.slice(0, 5).map((l) => (
                    <li key={l.placementId} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                      <Link
                        href={`/chef/hours/${l.placementId}`}
                        className="min-w-0 truncate text-ink-700 hover:text-burgundy hover:underline"
                      >
                        {l.company ?? "een klant"}{" "}
                        <span className="text-ink-400">
                          · {dayFmt.format(l.startsAt)} · {formatWorkedMinutes(l.workedMinutes)}
                        </span>
                      </Link>
                      <span className="shrink-0 font-mono text-ink-700">{formatEuro(l.amountCents)}</span>
                    </li>
                  ))}
                  {b.lines.length > 5 ? (
                    <li className="py-1.5 text-xs text-ink-400">
                      + {b.lines.length - 5} meer
                    </li>
                  ) : null}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-500">
            Indicatie op basis van je ingediende uren en je tarief. Het kantoor en payroll
            bevestigen het uiteindelijke bedrag en de uitbetaaldatum.
          </p>
        </section>
      ) : null}

      {/* CHEF-PR9a: vakantiegeld estimate — derived, INDICATIE only. */}
      {vacation.basisCents > 0 ? (
        <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className={LABEL}>Vakantiegeld (schatting)</p>
            <p className="text-2xl font-semibold text-ink-900">
              {formatEuro(vacation.accruedCents)}
            </p>
          </div>
          <p className="mt-2 text-sm text-ink-700">
            Ongeveer {vacation.pct}% over {formatEuro(vacation.basisCents)} aan goedgekeurde uren.
            Dit is een <strong>indicatie</strong> — payroll houdt de officiële opbouw en
            uitbetaling bij.
          </p>
          <p className="mt-1 text-xs text-ink-400">Aannames bijgewerkt: {vacation.assumptionsUpdated}</p>
        </section>
      ) : null}

      {!hasData ? (
        <p className="mt-6 rounded-lg border border-ink-200 bg-white p-6 text-center text-sm text-ink-500">
          Je hebt nog geen afgeronde diensten. Zodra je gewerkt hebt en de uren zijn
          goedgekeurd, zie je hier je verdiensten en patroon.
        </p>
      ) : (
        <>
          {patterns.clientEarnings.length > 0 ? (
            <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
              <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Verdiend per klant</p>
              <ul className="mt-3 divide-y divide-ink-100">
                {patterns.clientEarnings.map((c) => (
                  <li key={c.name} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-ink-700">
                      {c.name}{" "}
                      <span className="text-ink-400">
                        · {c.shifts} {c.shifts === 1 ? "dienst" : "diensten"}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-ink-900">{formatEuro(c.cents)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Je werkdagen</p>
              {patterns.busiestDayLabel ? (
                <p className="text-xs text-ink-500">
                  Je werkt meestal op{" "}
                  <strong className="text-ink-900">
                    {FULL_DAY[patterns.busiestDayLabel] ?? patterns.busiestDayLabel}
                  </strong>
                </p>
              ) : null}
            </div>
            <div className="mt-3 flex items-stretch gap-1.5">
              {patterns.preferredDays.map((d) => (
                <div key={d.weekday} className="flex flex-1 flex-col items-center">
                  <div className="flex h-16 w-full items-end">
                    <div
                      title={`${d.label}: ${d.count}`}
                      className="w-full rounded-t bg-burgundy/40"
                      style={{ height: `${Math.max(4, (d.count / maxDay) * 100)}%` }}
                    />
                  </div>
                  <span className="mt-1 text-[10px] text-ink-500">{d.label}</span>
                </div>
              ))}
            </div>

            {patterns.roleMix.length > 0 ? (
              <div className="mt-5">
                <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Je rollen</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {patterns.roleMix.map((r) => (
                    <span
                      key={r.role}
                      className="rounded-full border border-ink-200 bg-bg-gray px-2.5 py-1 text-xs text-ink-700"
                    >
                      {formatChefRole(r.role)} · {r.count}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </>
      )}

      <p className="mt-6 text-xs text-ink-500">
        Je openstaande en in-controle bedragen zie je op je{" "}
        <Link href="/chef" className="text-burgundy hover:underline">
          dashboard
        </Link>
        .
      </p>
    </div>
  );
}
