import { TrendTile } from "@/components/dashboard/TrendTile";
import { formatEuro } from "@/lib/hours-labels";
import type { ClientSummary, ClientTrends } from "@/lib/domain/client-history";

/**
 * Klant 360 — realized performance + 8-week trends. Pure-presentational section
 * relocated verbatim from clients/[id]/page.tsx (the JSX is character-identical
 * after whitespace normalization; the closure variables `clientSummary` and
 * `clientTrends` are now same-name props).
 */
export function Klant360({
  clientSummary,
  clientTrends,
}: {
  clientSummary: ClientSummary;
  clientTrends: ClientTrends;
}) {
  return (
    <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-serif text-lg text-ink-900">Klant 360</h2>
        <span className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-400">
          uit goedgekeurde uren · gerealiseerde diensten
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KSnap
          label="Bezetting"
          value={clientSummary.fillRate != null ? `${Math.round(clientSummary.fillRate * 100)}%` : "—"}
          note={`${clientSummary.realizedFilled}/${clientSummary.realizedSlots} plekken`}
        />
        <KSnap label="Omzet" value={formatEuro(clientSummary.spendCents)} note="gefactureerd" />
        <KSnap
          label="Marge"
          value={formatEuro(clientSummary.marginCents)}
          note={`loonkost ${formatEuro(clientSummary.loonCostCents)}`}
        />
        <KSnap
          label="Uren"
          value={`${clientSummary.totalHoursWorked} u`}
          note={`${clientSummary.completedShifts} diensten`}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-bg-gray px-2.5 py-1 text-ink-700">
          Vaste koks: <b className="text-ink-900">{clientSummary.repeatChefs}</b> van {clientSummary.distinctChefs}
        </span>
        <span className="rounded-full bg-bg-gray px-2.5 py-1 text-ink-700">
          Beoordelingen gegeven: <b className="text-ink-900">{clientSummary.ratingsGiven}</b>
          {clientSummary.averageRatingGiven != null ? ` · ${clientSummary.averageRatingGiven.toFixed(1)}★` : ""}
        </span>
        <span
          className={`rounded-full px-2.5 py-1 ${clientSummary.pendingSignoff > 0 ? "bg-amber-100 text-amber-800" : "bg-bg-gray text-ink-700"}`}
        >
          Uren te tekenen: <b>{clientSummary.pendingSignoff}</b>
        </span>
        {clientSummary.signoffAvgHours != null ? (
          <span className="rounded-full bg-bg-gray px-2.5 py-1 text-ink-700">
            Tekent gem. in <b className="text-ink-900">{clientSummary.signoffAvgHours} u</b>
          </span>
        ) : null}
      </div>

      {clientSummary.topChefs.length > 0 ? (
        <p className="mt-2 text-xs text-ink-600">
          Vaakst ingezet: {clientSummary.topChefs.map((c) => `${c.name} (${c.count}×)`).join(" · ")}
        </p>
      ) : null}

      <div className="mt-4">
        <p className="mb-2 font-ui text-[10px] font-medium uppercase tracking-wider text-ink-500">
          Trend · laatste 8 weken
        </p>
        {clientTrends.hasEnoughHistory ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TrendTile label="Omzet" spark={clientTrends.spendSparkline} value={`€ ${clientTrends.spendDelta.thisPeriod}`} delta={clientTrends.spendDelta} />
            <TrendTile label="Marge" spark={clientTrends.marginSparkline} value={`€ ${clientTrends.marginDelta.thisPeriod}`} delta={clientTrends.marginDelta} />
            <TrendTile label="Diensten" spark={clientTrends.shiftsSparkline} value={String(clientTrends.shiftsDelta.thisPeriod)} delta={clientTrends.shiftsDelta} />
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-ink-200 bg-bg-gray/40 px-3 py-2 text-xs text-ink-500">
            Te weinig historie voor een trend — vanaf ±2 weken activiteit verschijnt hier de 8-weekse grafiek.
          </p>
        )}
        <p className="mt-1 text-[10px] text-ink-500">
          {clientTrends.fillRate28d != null
            ? `Bezetting laatste 28 dagen: ${Math.round(clientTrends.fillRate28d * 100)}% · `
            : ""}
          Per week opgeteld uit de dagelijkse snapshot · deze week vs. vorige · ▲▼ alleen bij een betekenisvolle basis.
        </p>
      </div>
    </section>
  );
}

function KSnap({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-bg-gray/40 p-3">
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">{label}</p>
      <p className="mt-1 text-lg font-semibold leading-none text-ink-900">{value}</p>
      {note ? <p className="mt-1 text-[10px] text-ink-500">{note}</p> : null}
    </div>
  );
}
