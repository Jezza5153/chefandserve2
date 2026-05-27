"use client";

import { useState } from "react";

/**
 * BulkApproveBar — shown when the filter view contains magic-button
 * eligible rows. Lets Maarten select-all-eligible + bulk-approve in 2 clicks.
 *
 * Uses native form submission — the parent form posts to the server
 * action with all checked hoursId values.
 */

type Props = {
  eligibleCount: number;
  visible: boolean;
};

export function BulkApproveBar({ eligibleCount, visible }: Props) {
  const [selectedCount, setSelectedCount] = useState(0);

  if (!visible) return null;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4"
      onChange={(e) => {
        const form = (e.currentTarget as HTMLElement).closest("form");
        if (!form) return;
        const boxes = form.querySelectorAll<HTMLInputElement>(
          'input[name="hoursId"]:checked',
        );
        setSelectedCount(boxes.length);
      }}
    >
      <div className="text-sm">
        <strong className="text-emerald-800">{eligibleCount}</strong>{" "}
        <span className="text-emerald-700">
          {eligibleCount === 1
            ? "uurbriefje zonder afwijking"
            : "uurbriefjes zonder afwijking"}
        </span>
        {selectedCount > 0 ? (
          <span className="ml-2 text-emerald-700">
            · <strong>{selectedCount}</strong> geselecteerd
          </span>
        ) : null}
      </div>
      <div className="flex gap-2">
        <SelectAllButton />
        <button
          type="submit"
          disabled={selectedCount === 0}
          className="rounded-full bg-emerald-600 px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-ink-300"
        >
          Goedkeur geselecteerde
        </button>
      </div>
    </div>
  );
}

function SelectAllButton() {
  return (
    <button
      type="button"
      onClick={(e) => {
        const form = (e.currentTarget as HTMLElement).closest("form");
        if (!form) return;
        const boxes = form.querySelectorAll<HTMLInputElement>(
          'input[name="hoursId"]',
        );
        const allChecked = Array.from(boxes).every((b) => b.checked);
        boxes.forEach((b) => {
          b.checked = !allChecked;
        });
        // Trigger a change so the count updates
        form.dispatchEvent(new Event("change", { bubbles: true }));
      }}
      className="rounded-full border border-emerald-600 bg-white px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-700 hover:bg-emerald-100"
    >
      Selecteer alle
    </button>
  );
}
