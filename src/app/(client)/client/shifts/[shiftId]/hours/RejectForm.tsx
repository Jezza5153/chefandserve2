"use client";

/**
 * RejectForm — toggle-reveal for the "Niet akkoord" path on the klant
 * hours receipt page. Hidden until clicked; reveals a textarea + submit.
 *
 * Plain Dutch copy. Auto-focus when re-rendered with `error=reason-required`.
 */

import { useEffect, useRef, useState } from "react";

type Props = {
  hoursId: string;
  shiftId: string;
  rejectAction: (formData: FormData) => Promise<void> | void;
  autoFocus?: boolean;
};

export function RejectForm({
  hoursId,
  shiftId,
  rejectAction,
  autoFocus,
}: Props) {
  const [open, setOpen] = useState(Boolean(autoFocus));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) {
      setOpen(true);
      // Defer focus until after render
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [autoFocus]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setTimeout(() => textareaRef.current?.focus(), 0);
        }}
        className="rounded-full border border-burgundy/40 bg-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-burgundy hover:bg-burgundy/5"
      >
        ✗ Niet akkoord
      </button>
    );
  }

  return (
    <form action={rejectAction} className="w-full max-w-md space-y-3">
      <input type="hidden" name="hoursId" value={hoursId} />
      <input type="hidden" name="shiftId" value={shiftId} />
      <label className="block">
        <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
          Wat klopt er niet?
        </span>
        <textarea
          ref={textareaRef}
          name="clientNotes"
          required
          minLength={5}
          rows={4}
          placeholder="Bijv. ‘Chef was 30 min later begonnen’ of ‘pauze klopt niet’"
          className="w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
        />
      </label>
      <p className="text-xs text-ink-500">
        De chef krijgt jouw toelichting per mail en kan de uren aanpassen.
      </p>
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
        >
          Stuur terug naar chef
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full border border-ink-200 bg-white px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-700 hover:bg-bg-gray"
        >
          Annuleer
        </button>
      </div>
    </form>
  );
}
