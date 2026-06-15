"use client";

import { useMemo, useState } from "react";

import { estimatePayroll, estimateZzp, eur } from "@/lib/money";

/**
 * CHEF-PR8 — Money Explainer calculator (client). Live bruto/netto/zzp INDICATIE.
 * All numbers are estimates from owner-tunable assumptions — NOT a payslip.
 */
type Mode = "payroll" | "zzp" | "compare";

const fieldCls = "mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm";
const cardCls = "rounded-lg border border-ink-200 bg-white p-4";

function Line({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "border-t border-ink-200 pt-2" : ""}`}>
      <span className={`text-sm ${muted ? "text-ink-500" : "text-ink-700"}`}>{label}</span>
      <span className={`tabular-nums ${strong ? "text-base font-semibold text-ink-900" : "text-sm text-ink-800"}`}>
        {value}
      </span>
    </div>
  );
}

export function MoneyCalculator() {
  const [mode, setMode] = useState<Mode>("payroll");
  const [hourly, setHourly] = useState(18);
  const [hours, setHours] = useState(32);
  const [korting, setKorting] = useState(true);

  const payroll = useMemo(
    () => estimatePayroll({ grossHourly: hourly, hours, loonheffingskorting: korting }),
    [hourly, hours, korting],
  );
  const zzp = useMemo(() => estimateZzp({ hourly, hours }), [hourly, hours]);

  return (
    <div className="space-y-5">
      {/* Mode */}
      <div className="flex flex-wrap gap-2">
        {(["payroll", "zzp", "compare"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-full px-4 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.12em] ${
              mode === m ? "bg-burgundy text-white" : "border border-ink-200 bg-white text-ink-700"
            }`}
          >
            {m === "payroll" ? "Payroll" : m === "zzp" ? "ZZP" : "Vergelijk"}
          </button>
        ))}
      </div>

      {/* Inputs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-sm font-medium text-ink-900">
            {mode === "zzp" ? "Uurtarief (excl. btw)" : "Bruto uurtarief"}
          </span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={hourly}
            onChange={(e) => setHourly(Number(e.target.value))}
            className={fieldCls}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink-900">Uren</span>
          <input
            type="number"
            min={0}
            step={1}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className={fieldCls}
          />
        </label>
        {mode !== "zzp" && (
          <label className="flex items-end gap-2 pb-2 text-sm text-ink-700">
            <input type="checkbox" checked={korting} onChange={(e) => setKorting(e.target.checked)} className="accent-burgundy" />
            Loonheffingskorting
          </label>
        )}
      </div>

      {/* Results */}
      <div className={`grid gap-4 ${mode === "compare" ? "sm:grid-cols-2" : ""}`}>
        {(mode === "payroll" || mode === "compare") && (
          <div className={cardCls}>
            <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Payroll</p>
            <div className="mt-3 space-y-2">
              <Line label="Bruto" value={eur(payroll.grossCents)} />
              <Line label={`Vakantiegeld-opbouw (${8}%)`} value={eur(payroll.vacationCents)} muted />
              <Line label={`Geschat netto (≈${payroll.effectiveTaxPct}% inhouding)`} value={eur(payroll.netEstimateCents)} strong />
            </div>
            <ul className="mt-3 space-y-0.5 text-[11px] text-ink-500">
              <li>+ Vakantiegeld opgebouwd · vakantie-uren · payroll regelt inhouding</li>
              <li>Minder vrijheid, meer bescherming</li>
            </ul>
          </div>
        )}
        {(mode === "zzp" || mode === "compare") && (
          <div className={cardCls}>
            <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">ZZP</p>
            <div className="mt-3 space-y-2">
              <Line label="Omzet (excl. btw)" value={eur(zzp.grossExVatCents)} />
              <Line label="Btw (21%) — niet jouw geld" value={eur(zzp.vatCents)} muted />
              <Line label="Reservering inkomstenbelasting" value={`− ${eur(zzp.incomeTaxReserveCents)}`} muted />
              <Line label="Reservering Zvw" value={`− ${eur(zzp.zvwReserveCents)}`} muted />
              <Line label="Ruwe schatting wat je overhoudt" value={eur(zzp.keepEstimateCents)} strong />
            </div>
            <ul className="mt-3 space-y-0.5 text-[11px] text-ink-500">
              <li>Btw is geen inkomen · zet belasting/Zvw apart · geen automatisch vakantiegeld</li>
              <li>Meer vrijheid, meer risico · denk aan verzekering/tools/boekhouding</li>
            </ul>
          </div>
        )}
      </div>

      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
        <strong>Dit is een indicatie, geen officiële loonstrook of belastingadvies.</strong> Je
        echte netto hangt af van je persoonlijke situatie, heffingskortingen, meerdere banen,
        pensioen, payrollpartner, cao en het belastingjaar.
      </p>
    </div>
  );
}
