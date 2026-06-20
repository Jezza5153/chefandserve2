/**
 * /admin/business/overpromise — CHEF-PR10. The clickable home for the "which
 * hotels overpromise?" intelligence the AI already answers in chat. Ranks clients
 * by how far the delivered shift diverged from what was promised (uitloop, brief
 * klopte niet, gemiste pauze, chef wil niet terug), over a chosen window.
 *
 * Read-only · cockpit/clients read · AVG-safe: the read-model returns LABELS,
 * RATES and COUNTS only — never a chef's name, never a raw issue note. Each row is
 * evidence-cited (n = afgeronde shifts), and clients below the sample floor are
 * excluded so a single bad night can't brand a hotel.
 */
import Link from "next/link";

import { getOverpromiseByClient, type ClientOverpromise } from "@/lib/ai/read-model/overpromise";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Afwijkingen — gepland vs. werkelijk" };
export const dynamic = "force-dynamic";

const LABEL = "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy";
const WINDOWS = [30, 90, 180, 365] as const;

const pctStr = (n: number) => `${Math.round(n * 100)}%`;

/** Colour the composite score: green calm → amber watch → burgundy concern. */
function scoreChip(score: number): string {
  if (score >= 50) return "bg-burgundy/10 text-burgundy border-burgundy/20";
  if (score >= 25) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}

/** A rate cell that only "shouts" once it's both material and seen enough times. */
function RateCell({ rate, sample }: { rate: number; sample: number }) {
  if (sample === 0) return <span className="text-ink-300">—</span>;
  const hot = rate >= 0.34;
  return (
    <span className={hot ? "font-medium text-burgundy" : "text-ink-600"}>{pctStr(rate)}</span>
  );
}

export default async function OverpromiseReportPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  await requirePermission("clients", "read");
  const sp = await searchParams;
  const parsed = Number(sp.d);
  const windowDays = (WINDOWS as readonly number[]).includes(parsed) ? parsed : 90;

  const report = await getOverpromiseByClient(windowDays);
  const worst: ClientOverpromise | undefined = report.clients[0];

  return (
    <div className="mx-auto max-w-5xl">
      <p className={LABEL}>Afwijkingen</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Beloofd vs. waargemaakt</h1>
      <p className="mt-3 max-w-prose text-sm text-ink-700">
        Klanten gerangschikt op hoe vaak de dienst afweek van de afspraak — shifts die uitlopen,
        een brief die niet klopte, gemiste pauzes en chefs die er niet terug willen. Hoger =
        meer afwijking. Alleen klanten met minstens {report.minSample} afgeronde shifts in de
        periode; cijfers zijn aggregaten, geen namen van chefs of vrije tekst.
      </p>

      {/* Window selector */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="font-ui text-[11px] uppercase tracking-[0.15em] text-ink-500">Periode</span>
        {WINDOWS.map((d) => (
          <Link
            key={d}
            href={`/admin/business/overpromise?d=${d}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              d === windowDays
                ? "bg-burgundy text-white"
                : "border border-ink-200 text-ink-700 hover:bg-burgundy/10"
            }`}
          >
            {d === 365 ? "1 jaar" : `${d} dagen`}
          </Link>
        ))}
      </div>

      {/* "Wat gebeurt er nu?" guidance */}
      {worst ? (
        <p className="mt-4 rounded-lg border border-ink-200 bg-ink-50/60 p-3 text-sm text-ink-700">
          <strong className="text-ink-900">Wat gebeurt er nu?</strong>{" "}
          {worst.score >= 50 ? (
            <>
              <strong>{worst.company ?? "Een klant"}</strong> wijkt het meest af (score {worst.score}
              , uitloop {pctStr(worst.overrunRate)} over {worst.shifts} shifts). Overweeg de
              afspraken — verwachte uren, briefing, pauzeregeling — met deze klant door te nemen.
            </>
          ) : (
            <>Geen klant springt er sterk uit deze periode — afwijkingen blijven binnen de marge.</>
          )}
        </p>
      ) : null}

      {report.totalClients === 0 ? (
        <p className="mt-6 rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          Nog geen klanten met genoeg afgeronde shifts (min. {report.minSample}) in de laatste{" "}
          {windowDays} dagen. Naarmate er meer uren worden afgerond, vult dit overzicht zich.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-ink-200 bg-white">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-left font-ui text-[10px] uppercase tracking-[0.12em] text-ink-500">
                <th className="px-4 py-3">Klant</th>
                <th className="px-3 py-3 text-center">Score</th>
                <th className="px-3 py-3 text-right">Uitloop</th>
                <th className="px-3 py-3 text-right">Gem. uitloop</th>
                <th className="px-3 py-3 text-right">Off-brief</th>
                <th className="px-3 py-3 text-right">Geen pauze</th>
                <th className="px-3 py-3 text-right">Niet terug</th>
                <th className="px-3 py-3 text-right">Shifts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {report.clients.map((c) => (
                <tr key={c.clientId} className="hover:bg-ink-50/50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/business/clients/${c.clientId}`}
                      className="font-medium text-ink-900 hover:text-burgundy hover:underline"
                    >
                      {c.company ?? "Onbekende klant"}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span
                      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${scoreChip(
                        c.score,
                      )}`}
                    >
                      {c.score}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <RateCell rate={c.overrunRate} sample={c.shifts} />
                  </td>
                  <td className="px-3 py-3 text-right text-ink-600">
                    {c.avgOverrunMin > 0 ? `+${c.avgOverrunMin} min` : `${c.avgOverrunMin} min`}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <RateCell rate={c.offBriefRate} sample={c.reviews} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <RateCell rate={c.noBreakRate} sample={c.reviews} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <RateCell rate={c.wontReturnRate} sample={c.reviews} />
                  </td>
                  <td className="px-3 py-3 text-right text-ink-500">
                    {c.shifts}
                    {c.reviews < c.shifts ? (
                      <span className="text-ink-300"> · {c.reviews} review</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-ink-400">
        Off-brief, geen pauze en niet-terug worden alleen geteld over shifts mét een clock-out-review;
        de percentages staan ten opzichte van dat aantal reviews. Een streepje betekent: nog geen
        review. Dit is een signaal voor gesprek, geen automatisch oordeel.
      </p>
    </div>
  );
}
