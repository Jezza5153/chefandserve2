"use client";

/**
 * ChefFeedbackForm — klant sends an opmerking about a proposed chef
 * (PR-KLANT-3). Writes a placement_comments row (visibility='client_visible'),
 * NEVER placements.notes. The klant has NO veto: copy is "Stuur opmerking",
 * never "Akkoord"/"Goedkeuren"/"Beoordelen".
 */

import { useState } from "react";

export function ChefFeedbackForm({
  placementId,
  action,
}: {
  placementId: string;
  action: (formData: FormData) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-burgundy/40 bg-white px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5"
        >
          Stuur opmerking
        </button>
      ) : (
        <form action={action}>
          <input type="hidden" name="placementId" value={placementId} />
          <textarea
            name="body"
            rows={3}
            required
            minLength={1}
            maxLength={1000}
            placeholder="Bijv. ‘Heeft de chef HACCP-ervaring?’ of ‘Graag iemand die ook patisserie doet.’"
            className="w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="submit"
              className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
            >
              Versturen
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
      )}
    </div>
  );
}
