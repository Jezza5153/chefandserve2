/**
 * /chef/earnings — PR-INTEL. The chef's own verdiensten + werkpatronen, reusing
 * the same getChefPatterns intel the operator sees (their chef rate = their pay).
 * Read-only; auth IS the lookup (session.user.id → chefs.userId).
 */
import { eq } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import { getChefPatterns } from "@/lib/domain/intel";
import { formatEuro } from "@/lib/hours-labels";
import { formatChefRole } from "@/lib/labels";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Verdiensten" };
export const dynamic = "force-dynamic";

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
  const maxDay = Math.max(1, ...patterns.preferredDays.map((d) => d.count));
  const hasData = patterns.preferredDays.some((d) => d.count > 0);

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
