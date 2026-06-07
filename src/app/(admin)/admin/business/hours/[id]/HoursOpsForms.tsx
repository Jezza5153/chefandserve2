"use client";

import { useState } from "react";

import { fieldClass } from "@/components/forms/Fields";

type Action = (formData: FormData) => Promise<void> | void;

/**
 * Hours-ops admin controls (correct / void) for one shift_hours row.
 *
 * Mirrors AdminRejectForm's collapse pattern + the page's existing button
 * styling. The "use server" actions live in page.tsx and are passed in as
 * props. Which controls render is decided by the page (status gating); this
 * component just shows whatever it's handed.
 */
export function HoursCorrectForm({
  hoursId,
  editAction,
  startedAtLocal,
  endedAtLocal,
  breakMinutes,
  chefRateEur,
  clientRateEur,
  adminNotes,
}: {
  hoursId: string;
  editAction: Action;
  startedAtLocal: string;
  endedAtLocal: string;
  breakMinutes: number;
  chefRateEur: string;
  clientRateEur: string;
  adminNotes: string;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-ink-200 bg-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-700 hover:bg-bg-gray"
      >
        Uren corrigeren
      </button>
    );
  }
  return (
    <form action={editAction} className="max-w-xl space-y-4">
      <input type="hidden" name="hoursId" value={hoursId} />
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Uren corrigeren
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
            Begin
          </span>
          <input
            type="datetime-local"
            name="startedAt"
            required
            defaultValue={startedAtLocal}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
            Einde
          </span>
          <input
            type="datetime-local"
            name="endedAt"
            required
            defaultValue={endedAtLocal}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
            Pauze (minuten)
          </span>
          <input
            type="number"
            name="breakMinutes"
            min={0}
            step={1}
            defaultValue={breakMinutes}
            className={fieldClass}
          />
        </label>
        <div />
        <label className="block">
          <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
            Cheftarief (€/uur, optioneel)
          </span>
          <input
            type="number"
            name="chefRateEur"
            min={0}
            step="0.01"
            defaultValue={chefRateEur}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
            Klanttarief (€/uur, optioneel)
          </span>
          <input
            type="number"
            name="clientRateEur"
            min={0}
            step="0.01"
            defaultValue={clientRateEur}
            className={fieldClass}
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
          Interne notitie (optioneel)
        </span>
        <textarea
          name="adminNotes"
          rows={3}
          defaultValue={adminNotes}
          placeholder="Bijv. ‘Chef werkte 30 min langer — gecorrigeerd na overleg.’"
          className={`${fieldClass} placeholder-ink-500`}
        />
      </label>
      <p className="text-xs text-ink-500">
        Het totaal aantal gewerkte minuten wordt automatisch herberekend. De
        status blijft ongewijzigd.
      </p>
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
        >
          Correctie opslaan
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

export function HoursVoidForm({
  hoursId,
  voidAction,
}: {
  hoursId: string;
  voidAction: Action;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-red-300 bg-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-red-700 hover:bg-red-50"
      >
        Markeer als vervallen
      </button>
    );
  }
  return (
    <form action={voidAction} className="max-w-md space-y-3">
      <input type="hidden" name="hoursId" value={hoursId} />
      <label className="block">
        <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-red-700">
          Reden vervallen (min 3 tekens)
        </span>
        <input
          type="text"
          name="reason"
          required
          minLength={3}
          placeholder="Bijv. ‘No-show’ of ‘Shift geannuleerd na afronding.’"
          className={`${fieldClass} placeholder-ink-500`}
          autoFocus
        />
      </label>
      <p className="text-xs text-ink-500">
        Vervallen uren tellen niet mee voor uitbetaling of facturatie.
      </p>
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-full bg-red-600 px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-red-700"
        >
          Markeer als vervallen
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
