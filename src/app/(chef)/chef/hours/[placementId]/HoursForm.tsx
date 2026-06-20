"use client";

/**
 * HoursForm — client component for /chef/hours/[placementId].
 *
 * Quick-pick break buttons + live total + verwachte vergoeding.
 * Mobile-first: native datetime-local + number inputs, big tap targets.
 *
 * Server action is passed in as a prop so the parent (server component) can
 * call it without exposing the function across the client/server boundary.
 */

import { useMemo, useState } from "react";

import { fieldClass } from "@/components/forms/Fields";
import {
  computeChefAmountCents,
  formatEuro,
  formatWorkedMinutes,
} from "@/lib/hours-labels";
import { useT } from "@/lib/i18n/LocaleProvider";

type Props = {
  placementId: string;
  defaultStart: string;
  defaultEnd: string;
  defaultBreakMinutes: number;
  defaultNotes: string;
  chefRateCents: number;
  submitAction: (formData: FormData) => Promise<void> | void;
  errorMsg: string | null;
};

/** Quick-pick break presets, in minutes (0 = "none"; labels come from the dict). */
const QUICK_BREAKS = [0, 15, 30] as const;

export function HoursForm({
  placementId,
  defaultStart,
  defaultEnd,
  defaultBreakMinutes,
  defaultNotes,
  chefRateCents,
  submitAction,
  errorMsg,
}: Props) {
  const t = useT();
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [breakMinutes, setBreakMinutes] = useState(defaultBreakMinutes);
  const [customBreak, setCustomBreak] = useState(
    !QUICK_BREAKS.some((m) => m === defaultBreakMinutes),
  );
  const breakLabel = (m: number) => (m === 0 ? t.hours.breakNone : `${m} min`);

  const { workedMinutes, expectedCents, totalDeltaMinutes } = useMemo(() => {
    const s = new Date(start);
    const e = new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) {
      return { workedMinutes: 0, expectedCents: 0, totalDeltaMinutes: 0 };
    }
    const totalMin = Math.floor((e.getTime() - s.getTime()) / 60000);
    const worked = Math.max(0, totalMin - breakMinutes);
    return {
      workedMinutes: worked,
      expectedCents: computeChefAmountCents(worked, chefRateCents),
      totalDeltaMinutes: totalMin,
    };
  }, [start, end, breakMinutes, chefRateCents]);

  const breakTooLong = breakMinutes >= totalDeltaMinutes && totalDeltaMinutes > 0;

  return (
    <form action={submitAction} className="mt-8 space-y-6">
      <input type="hidden" name="placementId" value={placementId} />

      {/* Start / End */}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block font-ui text-[13px] font-medium text-ink-800">
            {t.hours.startLabel}
          </span>
          <input
            type="datetime-local"
            name="startedAt"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-full rounded border border-ink-200 bg-white px-4 py-3 font-mono text-base text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </label>

        <label className="block">
          <span className="mb-1 block font-ui text-[13px] font-medium text-ink-800">
            {t.hours.endLabel}
          </span>
          <input
            type="datetime-local"
            name="endedAt"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-full rounded border border-ink-200 bg-white px-4 py-3 font-mono text-base text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </label>
      </div>

      {/* Break — quick picks + custom */}
      <div>
        <span className="mb-2 block font-ui text-[13px] font-medium text-ink-800">
          {t.hours.breakLabel}
        </span>
        <div className="flex flex-wrap gap-2">
          {QUICK_BREAKS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setBreakMinutes(m);
                setCustomBreak(false);
              }}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                !customBreak && breakMinutes === m
                  ? "border-burgundy bg-burgundy text-white"
                  : "border-ink-200 bg-white text-ink-700 hover:border-burgundy/40"
              }`}
            >
              {breakLabel(m)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCustomBreak(true)}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              customBreak
                ? "border-burgundy bg-burgundy text-white"
                : "border-ink-200 bg-white text-ink-700 hover:border-burgundy/40"
            }`}
          >
            {t.hours.breakCustom}
          </button>
        </div>
        {customBreak ? (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="number"
              name="breakMinutes"
              min={0}
              max={480}
              step={5}
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(Number(e.target.value) || 0)}
              className="w-24 rounded border border-ink-200 bg-white px-3 py-2 font-mono text-base text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
            />
            <span className="text-sm text-ink-700">{t.hours.breakMinutesUnit}</span>
          </div>
        ) : (
          <input type="hidden" name="breakMinutes" value={breakMinutes} />
        )}
        {breakTooLong ? (
          <p className="mt-2 text-xs text-burgundy">{t.hours.breakTooLong}</p>
        ) : null}
      </div>

      {/* Notes */}
      <label className="block">
        <span className="mb-1 block font-ui text-[13px] font-medium text-ink-800">
          {t.hours.notesLabel}
        </span>
        <span className="mb-2 block text-xs leading-relaxed text-ink-500">
          {t.hours.notesHint}
        </span>
        <textarea
          name="chefNotes"
          rows={3}
          defaultValue={defaultNotes}
          placeholder={t.hours.notesPlaceholder}
          className={`${fieldClass} placeholder-ink-500`}
        />
      </label>

      {/* Live totals */}
      <div className="rounded-lg border border-ink-200 bg-bg-gray p-4">
        <div className="flex items-baseline justify-between">
          <span className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
            {t.hours.totalWorked}
          </span>
          <span className="font-mono text-lg text-ink-900">
            {formatWorkedMinutes(workedMinutes)}
          </span>
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
            {t.hours.expectedCompensation}
          </span>
          <span className="font-mono text-lg text-burgundy">
            {formatEuro(expectedCents)}
          </span>
        </div>
      </div>

      {errorMsg ? (
        <p className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
          {errorMsg}
        </p>
      ) : null}

      <p className="text-xs leading-relaxed text-ink-500">{t.hours.submitDisclaimer}</p>

      <button
        type="submit"
        disabled={breakTooLong || workedMinutes === 0}
        className="w-full rounded-full bg-burgundy px-6 py-4 font-ui text-[12px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900 disabled:cursor-not-allowed disabled:bg-ink-300"
      >
        {t.hours.submitHours}
      </button>
    </form>
  );
}
