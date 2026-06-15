"use client";

import { useState } from "react";

/**
 * Operations command bar (DASH-5b) — "Wat wil je oplossen?". A light intent router:
 * the typed question is handed to the floating assistant via the same `cs-ai:ask`
 * event the quick-ask chips use (AssistantWidget opens, AssistantChat prefills), so
 * the AI resolves "vul Hotel X morgen" / "wie is beschikbaar vandaag?" into a real
 * answer + confirm-gated action. Rendered only when the assistant is available, so
 * it's never a dead control.
 */
export function CommandBar() {
  const [q, setQ] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = q.trim();
    if (!prompt) return;
    window.dispatchEvent(new CustomEvent("cs-ai:ask", { detail: { prompt } }));
    setQ("");
  };

  return (
    <form onSubmit={submit} className="mt-5 flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0 text-burgundy" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
      </svg>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Wat wil je oplossen? Bijv. ‘vul Hotel X morgen’ of ‘wie is beschikbaar vandaag?’"
        aria-label="Wat wil je oplossen?"
        className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 placeholder-ink-400 focus:outline-none"
      />
      <button
        type="submit"
        className="shrink-0 rounded-full bg-burgundy px-4 py-1.5 font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-white hover:bg-burgundy-900"
      >
        Vraag
      </button>
    </form>
  );
}
