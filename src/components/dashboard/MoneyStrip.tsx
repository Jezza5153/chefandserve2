/**
 * MoneyStrip — KPI-5. A compact 3-up money strip (Deze week / Laatste 30 dagen / Dit jaar)
 * showing omzet · loonkost · marge from the KPI snapshot. Same MoneyCard renderer as the
 * insights page (FINAL-hours money via formatEuro). Read-only, server-safe.
 */
import type { MoneyWindow } from "@/lib/domain/platform-rollups";
import { formatEuro } from "@/lib/hours-labels";

function MoneyCard({ title, w }: { title: string; w: MoneyWindow }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-5">
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-ink-900">{formatEuro(w.revenueCents)}</p>
      <p className="text-[11px] text-ink-500">omzet</p>
      <dl className="mt-3 space-y-1 text-xs text-ink-600">
        <div className="flex justify-between gap-2">
          <dt>Loonkost</dt>
          <dd className="tabular-nums">{formatEuro(w.loonCostCents)}</dd>
        </div>
        <div className="flex justify-between gap-2 font-medium text-ink-900">
          <dt>Marge</dt>
          <dd className="tabular-nums">{formatEuro(w.marginCents)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function MoneyStrip({
  week,
  month,
  ytd,
}: {
  week: MoneyWindow;
  month: MoneyWindow;
  ytd: MoneyWindow;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <MoneyCard title="Deze week" w={week} />
      <MoneyCard title="Laatste 30 dagen" w={month} />
      <MoneyCard title="Dit jaar" w={ytd} />
    </div>
  );
}
