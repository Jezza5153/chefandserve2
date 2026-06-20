"use client";

import { useState } from "react";

import { fieldClass } from "@/components/forms/Fields";
import { useT } from "@/lib/i18n/LocaleProvider";

/**
 * RejectWithReason — small toggle-reveal so chef can add a reason when
 * declining. Reason is optional but helps Maarten match better next time.
 */
type Props = {
  placementId: string;
  respondAction: (formData: FormData) => Promise<void> | void;
};

/** Decline-reason enum values — server-validated; labels come from the dict. */
const DECLINE_REASONS = [
  "te_ver",
  "verkeerd_tijdstip",
  "al_bezet",
  "type_keuken",
  "geen_ontbijt",
  "geen_hotel",
  "klant_nee",
  "tarief",
  "anders",
] as const;

export function RejectWithReason({ placementId, respondAction }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-red-300 bg-white px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-red-700 hover:bg-red-50"
      >
        {t.shiftDetail.decline.button}
      </button>
    );
  }
  return (
    <form action={respondAction} className="w-full max-w-md space-y-3">
      <input type="hidden" name="placementId" value={placementId} />
      <input type="hidden" name="decision" value="rejected" />
      <fieldset>
        <legend className="mb-1.5 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
          {t.shiftDetail.decline.reasonPrompt}
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {DECLINE_REASONS.map((v) => (
            <label key={v} className="cursor-pointer">
              <input type="radio" name="declineReason" value={v} className="peer sr-only" />
              <span className="inline-block rounded-full border border-ink-200 bg-white px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-ink-600 hover:border-burgundy peer-checked:border-burgundy peer-checked:bg-burgundy peer-checked:text-white">
                {t.shiftDetail.decline.reasons[v]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
          {t.shiftDetail.decline.explanationLabel}
        </span>
        <textarea
          name="rejectionReason"
          rows={3}
          placeholder={t.shiftDetail.decline.explanationPlaceholder}
          className={`${fieldClass} placeholder-ink-500`}
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-full bg-red-700 px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-red-800"
        >
          {t.shiftDetail.decline.confirmButton}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full border border-ink-200 bg-white px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-700 hover:bg-bg-gray"
        >
          {t.shiftDetail.decline.abort}
        </button>
      </div>
    </form>
  );
}
