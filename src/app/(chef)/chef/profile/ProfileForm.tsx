"use client";

/**
 * ProfileForm — chef's directly-editable fields.
 *
 * Phone · city · languages (comma-separated) · specialties · segments (checkboxes).
 *
 * Native HTML form posting to the server action.
 */

import { useState } from "react";

import { fieldClass } from "@/components/forms/Fields";

const SEGMENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "casual", label: "Casual / brasserie" },
  { value: "fine_dining", label: "Fine dining" },
  { value: "hotel", label: "Hotel" },
  { value: "banqueting", label: "Banqueting" },
  { value: "catering", label: "Catering" },
  { value: "event", label: "Event" },
  { value: "corporate", label: "Corporate" },
  { value: "michelin", label: "Michelin" },
];

type Props = {
  chef: {
    phone: string | null;
    city: string | null;
    languages: string[] | null;
    specialties: string | null;
    segments: readonly string[];
  };
  saveAction: (formData: FormData) => Promise<void> | void;
};

export function ProfileForm({ chef, saveAction }: Props) {
  const [segments, setSegments] = useState<string[]>([...(chef.segments ?? [])]);

  function toggle(v: string) {
    setSegments((prev) =>
      prev.includes(v) ? prev.filter((s) => s !== v) : [...prev, v],
    );
  }

  return (
    <section className="mt-10">
      <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Direct aanpassen
      </h2>
      <p className="mt-1 text-xs text-ink-500">
        Telefoon, plaats, talen, specialteiten, segmenten — wijzigingen
        zijn meteen actief.
      </p>

      <form action={saveAction} className="mt-4 space-y-4">
        <label className="block">
          <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Telefoon
          </span>
          <input
            type="tel"
            name="phone"
            defaultValue={chef.phone ?? ""}
            placeholder="06-12345678"
            className={`${fieldClass} placeholder-ink-500`}
          />
        </label>

        <label className="block">
          <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Plaats
          </span>
          <input
            type="text"
            name="city"
            defaultValue={chef.city ?? ""}
            placeholder="Amsterdam"
            className={`${fieldClass} placeholder-ink-500`}
          />
        </label>

        <label className="block">
          <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Talen (gescheiden door komma's)
          </span>
          <input
            type="text"
            name="languages"
            defaultValue={chef.languages?.join(", ") ?? ""}
            placeholder="nl, en, fr"
            className={`${fieldClass} placeholder-ink-500`}
          />
        </label>

        <label className="block">
          <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Specialteiten (vrij veld)
          </span>
          <textarea
            name="specialties"
            rows={3}
            defaultValue={chef.specialties ?? ""}
            placeholder="bijv. patisserie · banketkok · Frans"
            className={`${fieldClass} placeholder-ink-500`}
          />
        </label>

        <div>
          <p className="mb-2 font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Segmenten waar je werkt
          </p>
          <div className="flex flex-wrap gap-2">
            {SEGMENT_OPTIONS.map((opt) => {
              const checked = segments.includes(opt.value);
              return (
                <label
                  key={opt.value}
                  className={`cursor-pointer rounded-full px-3 py-1.5 text-sm transition-colors ${
                    checked
                      ? "bg-burgundy text-white"
                      : "border border-ink-200 bg-white text-ink-700 hover:border-burgundy/40"
                  }`}
                >
                  <input
                    type="checkbox"
                    name="segments"
                    value={opt.value}
                    checked={checked}
                    onChange={() => toggle(opt.value)}
                    className="sr-only"
                  />
                  {opt.label}
                </label>
              );
            })}
          </div>
        </div>

        <button
          type="submit"
          className="rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
        >
          Profiel opslaan
        </button>
      </form>
    </section>
  );
}
