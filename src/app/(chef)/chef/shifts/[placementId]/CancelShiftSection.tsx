"use client";

/**
 * CancelShiftSection — cancellation flow with severity tiers.
 *
 * Tier copy + tel: CTA come from src/lib/cancellation-severity.ts.
 * Same-day cancels show a big "Bel Maarten" tel: link in addition to the
 * portal form — UX rule: status flip is NOT enough.
 */

import { useState } from "react";

import { fieldClass } from "@/components/forms/Fields";
import {
  CANCEL_REASONS,
  MAARTEN_PHONE,
  urgentCopy,
  type CancellationTier,
} from "@/lib/cancellation-severity";
import { fill } from "@/lib/i18n/locales";
import { type Dict } from "@/lib/i18n/get-dict";
import { useT } from "@/lib/i18n/LocaleProvider";

type Props = {
  placementId: string;
  tier: CancellationTier;
  cancelAction: (formData: FormData) => Promise<void> | void;
};

export function CancelShiftSection({
  placementId,
  tier,
  cancelAction,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const copy = urgentCopy(tier);

  if (!open) {
    return (
      <section className="mt-10 border-t border-ink-200 pt-6">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-ink-300 bg-white px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-700 hover:border-burgundy/40 hover:text-burgundy"
        >
          {t.shiftDetail.cancel.button}
        </button>
      </section>
    );
  }

  const wrapperCls =
    tier === "urgent"
      ? "rounded-lg border-2 border-burgundy bg-burgundy/5 p-5"
      : tier === "caution"
        ? "rounded-lg border border-amber-300 bg-amber-50 p-5"
        : "rounded-lg border border-ink-200 bg-white p-5";

  return (
    <section className="mt-10">
      <div className={wrapperCls}>
        <h2 className="font-serif text-xl text-ink-900">
          {tier === "urgent"
            ? t.shiftDetail.cancel.titleUrgent
            : tier === "caution"
              ? t.shiftDetail.cancel.titleCaution
              : t.shiftDetail.cancel.titleSafe}
        </h2>
        {/* copy.warning comes from the shared cancellation-severity lib (still NL) — a
            deeper locale-aware-helpers pass; the surrounding chrome is translated. */}
        <p className="mt-2 text-sm text-ink-700">{copy.warning}</p>

        {copy.showCallCta ? (
          <a
            href={`tel:${MAARTEN_PHONE}`}
            className="mt-4 inline-block rounded-full bg-burgundy px-6 py-3 font-ui text-[12px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
          >
            {fill(t.shiftDetail.cancel.callMaarten, { phone: MAARTEN_PHONE })}
          </a>
        ) : null}

        <form action={cancelAction} className="mt-5 space-y-3">
          <input type="hidden" name="placementId" value={placementId} />
          <fieldset>
            <legend className="mb-1.5 font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
              {t.shiftDetail.cancel.reasonLegend}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {CANCEL_REASONS.map((r, i) => (
                <label
                  key={r.key}
                  className="cursor-pointer rounded-full border border-ink-200 px-3 py-1.5 text-xs text-ink-700 has-[:checked]:border-burgundy has-[:checked]:bg-burgundy has-[:checked]:text-white"
                >
                  <input
                    type="radio"
                    name="cancelReason"
                    value={r.key}
                    defaultChecked={i === 0}
                    className="sr-only"
                  />
                  {t.shiftDetail.cancel.reasons[r.key as keyof Dict["shiftDetail"]["cancel"]["reasons"]] ?? r.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
              {t.shiftDetail.cancel.explanationLabel}
            </span>
            <textarea
              name="reason"
              required
              minLength={5}
              rows={4}
              placeholder={t.shiftDetail.cancel.explanationPlaceholder}
              className={`${fieldClass} placeholder-ink-500`}
              autoFocus
            />
          </label>
          <p className="text-xs text-ink-500">{t.shiftDetail.cancel.explanationHint}</p>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
            >
              {tier === "urgent" ? t.shiftDetail.cancel.submitUrgent : t.shiftDetail.cancel.submit}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-ink-200 bg-white px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-700 hover:bg-bg-gray"
            >
              {t.shiftDetail.cancel.abort}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
