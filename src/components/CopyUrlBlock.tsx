"use client";

/**
 * CopyUrlBlock — small client component that shows a long URL with a
 * Copy button. Used by /chef/calendar + /client/calendar.
 */

import { useState } from "react";

export function CopyUrlBlock({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback: select the text
      const input = document.getElementById("ics-url") as HTMLInputElement | null;
      input?.select();
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-ink-200 bg-bg-gray p-4">
      <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
        Jouw agenda-URL
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          id="ics-url"
          type="text"
          readOnly
          value={url}
          onClick={(e) => (e.target as HTMLInputElement).select()}
          className="w-full flex-1 rounded border border-ink-200 bg-white px-3 py-2 font-mono text-xs text-ink-700 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
        />
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
        >
          {copied ? "Gekopieerd ✓" : "Kopieer"}
        </button>
      </div>
    </div>
  );
}
