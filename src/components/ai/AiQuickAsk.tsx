"use client";

/**
 * AiQuickAsk (wave W2) — context-filled question chips that hand a prompt to the floating
 * assistant: dispatches `cs-ai:ask` (AssistantWidget opens, AssistantChat prefills the input —
 * the human still presses verstuur). Render only where the viewer actually has the widget
 * (the server page gates on the same role/flag logic as the layout).
 */
export function AiQuickAsk({ items }: { items: { label: string; prompt: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-400">
        Vraag de AI
      </span>
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("cs-ai:ask", { detail: { prompt: it.prompt } }))}
          className="rounded-full border border-burgundy/25 bg-burgundy/5 px-3 py-1 font-ui text-[11px] font-medium text-burgundy hover:border-burgundy/50"
        >
          ✦ {it.label}
        </button>
      ))}
    </div>
  );
}
