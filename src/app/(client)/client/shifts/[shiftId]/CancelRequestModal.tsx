"use client";

/**
 * CancelRequestModal — klant requests cancellation of an existing shift
 * (PR-KLANT-2). A cancel is a REQUEST, not an instant action: a chef is
 * already committed, so Chef & Serve contacts the klant + chef. Reason is
 * required (it helps both sides).
 */

import { useState } from "react";

import { fieldClass } from "@/components/forms/Fields";

export function CancelRequestModal({
  action,
  hasOpenRequest,
}: {
  action: (formData: FormData) => Promise<void> | void;
  hasOpenRequest: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (hasOpenRequest) {
    return (
      <span className="rounded-full border border-ink-200 bg-white px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-400">
        Annulering al aangevraagd
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full border border-red-300 bg-white px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-red-700 hover:bg-red-50"
      >
        Annulering aanvragen
      </button>

      {open ? (
        <form
          action={action}
          className="mt-3 w-full rounded-lg border border-red-200 bg-red-50/40 p-4"
        >
          <input type="hidden" name="kind" value="cancel" />
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Annulering aanvragen
          </p>
          <p className="mt-1 text-xs text-ink-700">
            Wij willen graag begrijpen waarom — dat helpt ons én de chef.
          </p>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-ink-500">
              Reden (verplicht, min 5 tekens)
            </span>
            <textarea
              name="reason"
              rows={3}
              required
              minLength={5}
              placeholder="Bijv. ‘evenement geannuleerd’ of ‘toch geen extra capaciteit nodig’"
              className={`${fieldClass} placeholder-ink-500`}
            />
          </label>

          <p className="mt-2 text-xs text-ink-500">
            Chef &amp; Serve neemt direct contact met je op.
          </p>

          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              className="rounded-full bg-red-700 px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-red-800"
            >
              Annuleringsverzoek versturen
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-ink-200 bg-white px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-700 hover:bg-bg-gray"
            >
              Annuleer
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}
