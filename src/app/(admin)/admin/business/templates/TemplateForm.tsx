"use client";

/**
 * TemplateForm — admin creates a recurring shift template with a LIVE
 * preview-before-save (PR-KLANT-4). As the admin fills the form, the panel
 * shows exactly which shifts will be generated (dates + overnight handling +
 * margin). "Eindigt volgende dag" auto-checks when end time <= start time.
 *
 * Submits to the create server action only after the admin confirms.
 */

import { useMemo, useState } from "react";

import {
  durationHours,
  formatIsoDate,
  formatTimeRange,
  isOvernight,
  previewDates,
} from "@/lib/shift-template-format";
import { formatShiftRole } from "@/lib/labels";

const VAKNIVEAU_OPTIONS = [
  { value: "keukenhulp", label: "Keukenhulp" },
  { value: "commis", label: "Commis" },
  { value: "chef_de_partie", label: "Chef de partie" },
  { value: "sous_chef", label: "Sous-chef" },
  { value: "chef_de_cuisine", label: "Chef de cuisine" },
  { value: "executive_chef", label: "Executive chef" },
  { value: "patissier", label: "Patissier" },
  { value: "bediening", label: "Bediening" },
];

const SEGMENT_OPTIONS = [
  { value: "", label: "— geen —" },
  { value: "casual", label: "Casual" },
  { value: "fine_dining", label: "Fine dining" },
  { value: "hotel", label: "Hotel" },
  { value: "banqueting", label: "Banqueting" },
  { value: "catering", label: "Catering" },
  { value: "event", label: "Event" },
  { value: "corporate", label: "Corporate" },
];

const DOW_OPTIONS = [
  { value: 1, label: "Maandag" },
  { value: 2, label: "Dinsdag" },
  { value: 3, label: "Woensdag" },
  { value: 4, label: "Donderdag" },
  { value: 5, label: "Vrijdag" },
  { value: 6, label: "Zaterdag" },
  { value: 0, label: "Zondag" },
];

const inputCls =
  "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy";
const labelCls =
  "mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy";

export function TemplateForm({
  clientId,
  action,
}: {
  clientId: string;
  action: (formData: FormData) => Promise<void> | void;
}) {
  const [roleNeeded, setRoleNeeded] = useState("sous_chef");
  const [segment, setSegment] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState(5);
  const [startsAtTime, setStartsAtTime] = useState("17:00");
  const [endsAtTime, setEndsAtTime] = useState("23:00");
  const [endsNextDay, setEndsNextDay] = useState(false);
  const [headcount, setHeadcount] = useState(1);
  const [chefRate, setChefRate] = useState("");
  const [clientRate, setClientRate] = useState("");
  const [horizonDays, setHorizonDays] = useState(28);
  const [confirming, setConfirming] = useState(false);

  // Auto-detect overnight when end <= start.
  const overnight = isOvernight(startsAtTime, endsAtTime, endsNextDay);
  const dates = useMemo(
    () => previewDates(dayOfWeek, horizonDays),
    [dayOfWeek, horizonDays],
  );
  const hours = durationHours(startsAtTime, endsAtTime, endsNextDay);
  const marginPerShift =
    chefRate && clientRate
      ? Math.round((Number(clientRate) - Number(chefRate)) * hours)
      : null;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="clientId" value={clientId} />

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className={labelCls}>Rol</span>
          <select
            name="roleNeeded"
            value={roleNeeded}
            onChange={(e) => setRoleNeeded(e.target.value)}
            className={inputCls}
          >
            {VAKNIVEAU_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={labelCls}>Segment</span>
          <select
            name="segment"
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            className={inputCls}
          >
            {SEGMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={labelCls}>Dag van de week</span>
          <select
            name="dayOfWeek"
            value={dayOfWeek}
            onChange={(e) => setDayOfWeek(Number(e.target.value))}
            className={inputCls}
          >
            {DOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={labelCls}>Aantal chefs</span>
          <input
            type="number"
            name="headcount"
            min={1}
            max={20}
            value={headcount}
            onChange={(e) => setHeadcount(Number(e.target.value))}
            className={`${inputCls} font-mono`}
          />
        </label>

        <label className="block">
          <span className={labelCls}>Starttijd</span>
          <input
            type="time"
            name="startsAtTime"
            value={startsAtTime}
            onChange={(e) => setStartsAtTime(e.target.value)}
            required
            className={`${inputCls} font-mono`}
          />
        </label>

        <label className="block">
          <span className={labelCls}>Eindtijd</span>
          <input
            type="time"
            name="endsAtTime"
            value={endsAtTime}
            onChange={(e) => setEndsAtTime(e.target.value)}
            required
            className={`${inputCls} font-mono`}
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-900">
        <input
          type="checkbox"
          name="endsNextDay"
          checked={overnight}
          onChange={(e) => setEndsNextDay(e.target.checked)}
          className="accent-burgundy"
        />
        Eindigt volgende dag {overnight && endsAtTime <= startsAtTime ? "(automatisch)" : ""}
      </label>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className={labelCls}>Chef-tarief (€/uur)</span>
          <input
            type="number"
            name="chefRateEur"
            min={0}
            step={1}
            value={chefRate}
            onChange={(e) => setChefRate(e.target.value)}
            className={`${inputCls} font-mono`}
          />
        </label>
        <label className="block">
          <span className={labelCls}>Klant-tarief (€/uur)</span>
          <input
            type="number"
            name="clientRateEur"
            min={0}
            step={1}
            value={clientRate}
            onChange={(e) => setClientRate(e.target.value)}
            className={`${inputCls} font-mono`}
          />
        </label>
        <label className="block">
          <span className={labelCls}>Horizon (dagen)</span>
          <input
            type="number"
            name="horizonDays"
            min={7}
            max={120}
            value={horizonDays}
            onChange={(e) => setHorizonDays(Number(e.target.value))}
            className={`${inputCls} font-mono`}
          />
        </label>
      </div>

      <label className="block">
        <span className={labelCls}>Notities (optioneel)</span>
        <textarea name="notes" rows={2} className={inputCls} />
      </label>

      {/* Preview-before-save */}
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-full border border-burgundy/40 bg-white px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-burgundy hover:bg-burgundy/5"
        >
          Voorbeeld bekijken →
        </button>
      ) : (
        <div className="rounded-lg border border-burgundy/30 bg-burgundy/5 p-5">
          <h3 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Deze template maakt de volgende shifts aan
          </h3>
          <ul className="mt-3 space-y-1 text-sm text-ink-900">
            {dates.slice(0, 8).map((iso) => (
              <li key={iso} className="font-mono text-xs">
                ✓ {formatIsoDate(iso)} · {formatTimeRange(startsAtTime, endsAtTime, endsNextDay)} ·{" "}
                {formatShiftRole(roleNeeded)} · {headcount} chef{headcount === 1 ? "" : "s"}
              </li>
            ))}
            {dates.length > 8 ? (
              <li className="text-xs text-ink-500">+ {dates.length - 8} meer in de horizon</li>
            ) : null}
            {dates.length === 0 ? (
              <li className="text-xs text-ink-500">
                Geen datums in de horizon — controleer dag + horizon.
              </li>
            ) : null}
          </ul>
          <p className="mt-3 text-sm text-ink-700">
            {chefRate && clientRate ? (
              <>
                Tariefafspraak: €{chefRate}/uur chef · €{clientRate}/uur klant ·{" "}
                <strong>marge €{marginPerShift} per shift</strong> ({hours} uur)
              </>
            ) : (
              <>Duur: {hours} uur per shift</>
            )}
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              className="rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
            >
              Bevestig en activeer
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-full border border-ink-200 bg-white px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-700 hover:bg-bg-gray"
            >
              Terug naar bewerken
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
