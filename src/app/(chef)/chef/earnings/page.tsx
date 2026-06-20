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
import { getI18n } from "@/lib/i18n/server";
import { fill, INTL_TAG, type Locale } from "@/lib/i18n/locales";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Verdiensten" };
export const dynamic = "force-dynamic";

/** "€X" when the rate is pinned, "€X – €Y" when only the chef's band is known. */
function forecastAmount(minCents: number, maxCents: number): string {
  return maxCents > minCents
    ? `${formatEuro(minCents)} – ${formatEuro(maxCents)}`
    : formatEuro(minCents);
}

/** Expand the busiest-day abbreviation (Ma/Di/…) to a full name per locale. */
const FULL_DAY: Record<Locale, Record<string, string>> = {
  nl: {
    Ma: "maandag",
    Di: "dinsdag",
    Wo: "woensdag",
    Do: "donderdag",
    Vr: "vrijdag",
    Za: "zaterdag",
    Zo: "zondag",
  },
  en: {
    Ma: "Monday",
    Di: "Tuesday",
    Wo: "Wednesday",
    Do: "Thursday",
    Vr: "Friday",
    Za: "Saturday",
    Zo: "Sunday",
  },
};
const LABEL = "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy";

export default async function ChefEarningsPage() {
  const session = await requireAuth("/chef/earnings");
  const { locale, dict: t } = await getI18n();
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.userId, session.user.id) });
  if (!chef) {
    return (
      <p className="rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
        {t.common.noChefProfile}
      </p>
    );
  }

  const patterns = await getChefPatterns(chef.id);
  const forecast = await getChefForecastEarnings(chef.id);
  const payments = await getChefPaymentStatus(chef.id);
  const vacation = await getChefVacationEstimate(chef.id);
  const maxDay = Math.max(1, ...patterns.preferredDays.map((d) => d.count));
  const hasData = patterns.preferredDays.some((d) => d.count > 0);
  const unit = (n: number) => (n === 1 ? t.common.shift : t.common.shifts);
  const dayFmt = new Intl.DateTimeFormat(INTL_TAG[locale], {
    timeZone: "Europe/Amsterdam",
    day: "numeric",
    month: "short",
  });

  return (
    <div>
      <p className={LABEL}>{t.earnings.eyebrow}</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">{t.earnings.title}</h1>
      <p className="mt-3 max-w-prose text-sm text-ink-700">{t.earnings.intro}</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">{t.earnings.totalEarned}</p>
          <p className="mt-1 text-3xl font-semibold text-ink-900">
            {formatEuro(patterns.totalEarnedCents)}
          </p>
          <p className="text-xs text-ink-500">{t.earnings.totalEarnedSub}</p>
        </div>
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">{t.earnings.last30}</p>
          <p className="mt-1 text-3xl font-semibold text-ink-900">
            {formatEuro(patterns.earned30dCents)}
          </p>
          <p className="text-xs text-ink-500">{t.earnings.last30Sub}</p>
        </div>
      </div>

      {/* Forward view — verwachte verdiensten uit bevestigde shifts. */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
            {fill(t.earnings.forecastLabel, { days: forecast.daysAhead })}
          </p>
          {forecast.totalShifts > 0 ? (
            <p className="text-2xl font-semibold text-ink-900">
              {forecastAmount(forecast.totalMinCents, forecast.totalMaxCents)}
            </p>
          ) : null}
        </div>
        {forecast.totalShifts === 0 ? (
          <p className="mt-2 text-sm text-ink-500">{t.earnings.forecastEmpty}</p>
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
                      · {w.shifts} {unit(w.shifts)}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-ink-900">
                    {forecastAmount(w.minCents, w.maxCents)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-500">{t.earnings.forecastDisclaimer}</p>
          </>
        )}
      </section>

      {/* CHEF-PR9a: "Wanneer word ik betaald?" — payout pipeline over the hours chain. */}
      {payments.buckets.length > 0 ? (
        <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className={LABEL}>{t.earnings.whenPaid}</p>
            {payments.inFlightCents > 0 ? (
              <p className="text-sm text-ink-500">
                {t.earnings.onTheWay}{" "}
                <strong className="text-ink-900">{formatEuro(payments.inFlightCents)}</strong>
              </p>
            ) : null}
          </div>
          <div className="mt-3 space-y-3">
            {payments.buckets.map((b) => (
              <div key={b.stage} className="rounded-md border border-ink-100 bg-bg-gray/40 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-ink-900">
                    {t.payments.stages[b.stage].label}{" "}
                    <span className="text-ink-400">
                      · {b.count} {unit(b.count)}
                    </span>
                  </p>
                  <span className="font-mono text-sm text-ink-900">{formatEuro(b.amountCents)}</span>
                </div>
                <p className="mt-1 text-xs text-ink-500">{t.payments.stages[b.stage].nextStep}</p>
                <ul className="mt-2 divide-y divide-ink-100">
                  {b.lines.slice(0, 5).map((l) => (
                    <li key={l.placementId} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                      <Link
                        href={`/chef/hours/${l.placementId}`}
                        className="min-w-0 truncate text-ink-700 hover:text-burgundy hover:underline"
                      >
                        {l.company ?? t.common.aClient}{" "}
                        <span className="text-ink-400">
                          · {dayFmt.format(l.startsAt)} · {formatWorkedMinutes(l.workedMinutes)}
                        </span>
                      </Link>
                      <span className="shrink-0 font-mono text-ink-700">{formatEuro(l.amountCents)}</span>
                    </li>
                  ))}
                  {b.lines.length > 5 ? (
                    <li className="py-1.5 text-xs text-ink-400">
                      {fill(t.earnings.andMore, { n: b.lines.length - 5 })}
                    </li>
                  ) : null}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-500">{t.earnings.paymentsDisclaimer}</p>
        </section>
      ) : null}

      {/* CHEF-PR9a: vakantiegeld estimate — derived, INDICATIE only. */}
      {vacation.basisCents > 0 ? (
        <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className={LABEL}>{t.earnings.vacationTitle}</p>
            <p className="text-2xl font-semibold text-ink-900">
              {formatEuro(vacation.accruedCents)}
            </p>
          </div>
          <p className="mt-2 text-sm text-ink-700">
            {fill(t.earnings.vacationBodyA, {
              pct: vacation.pct,
              basis: formatEuro(vacation.basisCents),
            })}
            <strong>{t.common.estimate}</strong>
            {t.earnings.vacationBodyB}
          </p>
          <p className="mt-1 text-xs text-ink-400">
            {fill(t.earnings.assumptionsUpdated, { date: vacation.assumptionsUpdated })}
          </p>
        </section>
      ) : null}

      {!hasData ? (
        <p className="mt-6 rounded-lg border border-ink-200 bg-white p-6 text-center text-sm text-ink-500">
          {t.earnings.noData}
        </p>
      ) : (
        <>
          {patterns.clientEarnings.length > 0 ? (
            <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
              <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">{t.earnings.perClient}</p>
              <ul className="mt-3 divide-y divide-ink-100">
                {patterns.clientEarnings.map((c) => (
                  <li key={c.name} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-ink-700">
                      {c.name}{" "}
                      <span className="text-ink-400">
                        · {c.shifts} {unit(c.shifts)}
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
              <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">{t.earnings.workdays}</p>
              {patterns.busiestDayLabel ? (
                <p className="text-xs text-ink-500">
                  {t.earnings.busiestOn}{" "}
                  <strong className="text-ink-900">
                    {FULL_DAY[locale][patterns.busiestDayLabel] ?? patterns.busiestDayLabel}
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
                <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">{t.earnings.roles}</p>
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
        {t.earnings.outstandingPre}
        <Link href="/chef" className="text-burgundy hover:underline">
          {t.earnings.dashboardLink}
        </Link>
        .
      </p>
    </div>
  );
}
