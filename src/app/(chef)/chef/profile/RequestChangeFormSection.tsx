"use client";

/**
 * RequestChangeFormSection — UI for the four "vraag wijziging aan" fields:
 *   - Uurtarief (min/max numeric)
 *   - Vakniveau (dropdown)
 *   - Naam (text)
 *   - E-mailadres (email)
 *
 * Each "Verzoek wijziging" button opens a small inline form. Submits to the
 * server action with `field` + `proposed`/`hourlyRateMin`/`hourlyRateMax`
 * + `reason`.
 */

import { useState } from "react";

import { fieldClass } from "@/components/forms/Fields";
import { formatChefRole } from "@/lib/labels";
import { fill } from "@/lib/i18n/locales";
import { useT } from "@/lib/i18n/LocaleProvider";

/** Vakniveau enum values (server-validated); labels come from the dict. */
const VAKNIVEAU_VALUES = [
  "keukenhulp",
  "commis",
  "chef_de_partie",
  "sous_chef",
  "chef_de_cuisine",
  "executive_chef",
  "patissier",
] as const;

type Props = {
  chef: {
    fullName: string;
    email: string | null;
    vakniveau: string | null;
    hourlyRateMinCents: number | null;
    hourlyRateMaxCents: number | null;
  };
  requestAction: (formData: FormData) => Promise<void> | void;
};

type Field = "fullName" | "email" | "vakniveau" | "hourlyRate" | null;

export function RequestChangeFormSection({ chef, requestAction }: Props) {
  const t = useT();
  const [open, setOpen] = useState<Field>(null);
  return (
    <section className="mt-10 rounded-lg border border-burgundy/20 bg-burgundy/5 p-5">
      <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        {t.profileForm.requestHeading}
      </h2>
      <p className="mt-1 text-xs text-ink-700">{t.profileForm.requestIntro}</p>

      <ul className="mt-4 space-y-3">
        <Row
          label={t.profile.field.fullName}
          current={chef.fullName}
          onOpen={() => setOpen("fullName")}
        />
        <Row
          label={t.profile.field.email}
          current={chef.email ?? "—"}
          onOpen={() => setOpen("email")}
        />
        <Row
          label={t.profile.field.vakniveau}
          current={formatChefRole(chef.vakniveau)}
          onOpen={() => setOpen("vakniveau")}
        />
        <Row
          label={t.profile.field.hourlyRate}
          current={`€${chef.hourlyRateMinCents ? (chef.hourlyRateMinCents / 100).toFixed(0) : "—"} – €${chef.hourlyRateMaxCents ? (chef.hourlyRateMaxCents / 100).toFixed(0) : "—"}`}
          onOpen={() => setOpen("hourlyRate")}
        />
      </ul>

      {open !== null ? (
        <form
          action={requestAction}
          className="mt-4 rounded-lg border border-ink-200 bg-white p-4"
        >
          <input type="hidden" name="field" value={open} />
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            {fill(t.profileForm.changeFor, { field: t.profile.field[open] })}
          </p>

          {open === "hourlyRate" ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-ink-500">
                  {t.profileForm.rateMin}
                </span>
                <input
                  type="number"
                  name="hourlyRateMin"
                  min={0}
                  step={1}
                  defaultValue={chef.hourlyRateMinCents ? (chef.hourlyRateMinCents / 100).toFixed(0) : ""}
                  required
                  className="w-full rounded border border-ink-200 bg-white px-3 py-2 font-mono text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink-500">
                  {t.profileForm.rateMax}
                </span>
                <input
                  type="number"
                  name="hourlyRateMax"
                  min={0}
                  step={1}
                  defaultValue={chef.hourlyRateMaxCents ? (chef.hourlyRateMaxCents / 100).toFixed(0) : ""}
                  required
                  className="w-full rounded border border-ink-200 bg-white px-3 py-2 font-mono text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
                />
              </label>
            </div>
          ) : open === "vakniveau" ? (
            <label className="mt-3 block">
              <span className="mb-1 block text-xs text-ink-500">{t.profileForm.newLevel}</span>
              <select
                name="proposed"
                required
                defaultValue={chef.vakniveau ?? ""}
                className={fieldClass}
              >
                <option value="" disabled>
                  {t.profileForm.chooseLevel}
                </option>
                {VAKNIVEAU_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {t.profileForm.vakniveau[value]}
                  </option>
                ))}
              </select>
            </label>
          ) : open === "email" ? (
            <label className="mt-3 block">
              <span className="mb-1 block text-xs text-ink-500">{t.profileForm.newEmail}</span>
              <input
                type="email"
                name="proposed"
                required
                defaultValue={chef.email ?? ""}
                className={fieldClass}
              />
            </label>
          ) : (
            <label className="mt-3 block">
              <span className="mb-1 block text-xs text-ink-500">{t.profileForm.newName}</span>
              <input
                type="text"
                name="proposed"
                required
                defaultValue={chef.fullName}
                className={fieldClass}
              />
            </label>
          )}

          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-ink-500">{t.profileForm.reasonLabel}</span>
            <textarea
              name="reason"
              rows={3}
              required
              minLength={5}
              placeholder={t.profileForm.reasonPlaceholder}
              className={`${fieldClass} placeholder-ink-500`}
            />
          </label>

          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
            >
              {t.profileForm.submit}
            </button>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="rounded-full border border-ink-200 bg-white px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-700 hover:bg-bg-gray"
            >
              {t.profileForm.abort}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function Row({
  label,
  current,
  onOpen,
}: {
  label: string;
  current: string;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <li className="flex items-center justify-between gap-3 rounded border border-ink-200 bg-white px-4 py-3">
      <div>
        <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
          {label}
        </p>
        <p className="text-sm text-ink-900">{current}</p>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="rounded-full border border-burgundy/40 bg-white px-3 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5"
      >
        {t.profileForm.requestButton}
      </button>
    </li>
  );
}
