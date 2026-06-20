"use client";

import { useMemo, useState } from "react";

import { estimatePayroll, estimateZzp, eur, type MoneyAssumptions } from "@/lib/money";
import { fill } from "@/lib/i18n/locales";
import { useT } from "@/lib/i18n/LocaleProvider";

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

export function MoneyCalculator({ assumptions }: { assumptions: MoneyAssumptions }) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("payroll");
  const [hourly, setHourly] = useState(18);
  const [hours, setHours] = useState(32);
  const [korting, setKorting] = useState(true);

  const payroll = useMemo(
    () => estimatePayroll({ grossHourly: hourly, hours, loonheffingskorting: korting, a: assumptions }),
    [hourly, hours, korting, assumptions],
  );
  const zzp = useMemo(() => estimateZzp({ hourly, hours, a: assumptions }), [hourly, hours, assumptions]);

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
            {m === "payroll" ? t.money.modePayroll : m === "zzp" ? t.money.modeZzp : t.money.modeCompare}
          </button>
        ))}
      </div>

      {/* Inputs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-sm font-medium text-ink-900">
            {mode === "zzp" ? t.money.rateZzp : t.money.ratePayroll}
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
          <span className="text-sm font-medium text-ink-900">{t.money.hoursLabel}</span>
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
            {t.money.taxReduction}
          </label>
        )}
      </div>

      {/* Results */}
      <div className={`grid gap-4 ${mode === "compare" ? "sm:grid-cols-2" : ""}`}>
        {(mode === "payroll" || mode === "compare") && (
          <div className={cardCls}>
            <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">{t.money.modePayroll}</p>
            <div className="mt-3 space-y-2">
              <Line label={t.money.gross} value={eur(payroll.grossCents)} />
              <Line label={fill(t.money.vacationAccrual, { pct: 8 })} value={eur(payroll.vacationCents)} muted />
              <Line label={fill(t.money.estimatedNet, { pct: payroll.effectiveTaxPct })} value={eur(payroll.netEstimateCents)} strong />
            </div>
            <ul className="mt-3 space-y-0.5 text-[11px] text-ink-500">
              <li>{t.money.payrollNote1}</li>
              <li>{t.money.payrollNote2}</li>
            </ul>
          </div>
        )}
        {(mode === "zzp" || mode === "compare") && (
          <div className={cardCls}>
            <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">{t.money.modeZzp}</p>
            <div className="mt-3 space-y-2">
              <Line label={t.money.revenue} value={eur(zzp.grossExVatCents)} />
              <Line label={t.money.vat} value={eur(zzp.vatCents)} muted />
              <Line label={t.money.incomeTaxReserve} value={`− ${eur(zzp.incomeTaxReserveCents)}`} muted />
              <Line label={t.money.zvwReserve} value={`− ${eur(zzp.zvwReserveCents)}`} muted />
              <Line label={t.money.zzpEstimate} value={eur(zzp.keepEstimateCents)} strong />
            </div>
            <ul className="mt-3 space-y-0.5 text-[11px] text-ink-500">
              <li>{t.money.zzpNote1}</li>
              <li>{t.money.zzpNote2}</li>
            </ul>
          </div>
        )}
      </div>

      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
        <strong>{t.money.disclaimerStrong}</strong>{t.money.disclaimerRest}
      </p>
    </div>
  );
}
