"use client";

import { useState } from "react";

import { fieldClass } from "@/components/forms/Fields";

type Props = {
  hoursId: string;
  rejectAction: (formData: FormData) => Promise<void> | void;
};

export function AdminRejectForm({ hoursId, rejectAction }: Props) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-3 rounded-full border border-burgundy/40 bg-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-burgundy hover:bg-burgundy/5"
      >
        ✗ Terugzetten naar chef
      </button>
    );
  }
  return (
    <form action={rejectAction} className="mt-4 max-w-md space-y-3">
      <input type="hidden" name="hoursId" value={hoursId} />
      <label className="block">
        <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
          Reden teruggezet (min 5 tekens)
        </span>
        <textarea
          name="adminNotes"
          required
          minLength={5}
          rows={4}
          placeholder="Bijv. ‘Pauze ontbreekt — graag toevoegen en opnieuw indienen.’"
          className={`${fieldClass} placeholder-ink-500`}
          autoFocus
        />
      </label>
      <p className="text-xs text-ink-500">
        Chef en klant krijgen je toelichting per mail. Het uurbriefje gaat
        terug naar de chef voor aanpassing.
      </p>
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
        >
          Terugzetten naar chef
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
