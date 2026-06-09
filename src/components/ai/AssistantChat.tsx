"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type ChatMsg = { role: "user" | "assistant"; content: string };
type Pending = { tool: string; input: unknown; summary: string; token: string };

type ApiResponse = {
  disabled?: boolean;
  message?: string;
  error?: string;
  outcome?:
    | { kind: "final"; text: string }
    | {
        kind: "awaiting_confirmation";
        confirmation: { summary: string; token: string };
        pending: { tool: string; input: unknown };
      };
  result?: { status: string; summary?: string; reason?: string; error?: string };
};

/**
 * The owner assistant's chat surface. Used by both the dedicated /admin/assistant page
 * (`variant="page"`) and the floating AssistantWidget (`variant="widget"`, a compact
 * flex-column that scrolls internally). Same /api/ai/chat round-trip + confirm gate.
 */
export function AssistantChat({
  enabled,
  variant = "page",
  endpoint = "/api/ai/chat",
  placeholder = "Stel een vraag, bijvoorbeeld: “wie heeft z’n uren nog niet goedgekeurd?”",
}: {
  enabled: boolean;
  variant?: "page" | "widget";
  /** Chat endpoint — defaults to the owner channel; the portal passes /api/ai/portal/chat. */
  endpoint?: string;
  /** Empty-state hint, tailored per persona. */
  placeholder?: string;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 👍/👎 per assistant-message index — the learning loop's intake (POST /api/ai/feedback).
  const [rated, setRated] = useState<Record<number, "up" | "down">>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Persist the conversation per channel so closing the widget or navigating pages
  // (both unmount this component) doesn't wipe the chat. sessionStorage = survives within
  // the tab/session, resets on a fresh tab — the right lifetime for a chat.
  const storageKey = `ai-chat:${endpoint}`;
  const skipFirstSave = useRef(true);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as {
          msgs?: ChatMsg[];
          pending?: Pending | null;
          rated?: Record<number, "up" | "down">;
        };
        if (Array.isArray(saved.msgs)) setMsgs(saved.msgs);
        if (saved.pending) setPending(saved.pending);
        if (saved.rated && typeof saved.rated === "object") setRated(saved.rated);
      }
    } catch {
      // ignore corrupt/blocked storage
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    if (skipFirstSave.current) {
      skipFirstSave.current = false; // don't overwrite saved data with the empty mount state
      return;
    }
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ msgs, pending, rated }));
    } catch {
      // ignore
    }
  }, [msgs, pending, rated, storageKey]);

  // keep the newest message in view (matters most in the compact widget)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, pending, busy]);

  function clearConversation() {
    setMsgs([]);
    setPending(null);
    setError(null);
    setRated({});
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }

  const pushAssistant = (content: string) =>
    setMsgs((m) => [...m, { role: "assistant", content }]);

  function applyResponse(data: ApiResponse) {
    if (data.disabled && data.message) {
      pushAssistant(data.message);
      return;
    }
    if (data.error) {
      setError(data.error);
      return;
    }
    if (data.result) {
      const r = data.result;
      pushAssistant(
        r.status === "ok"
          ? r.summary ?? "Gedaan."
          : r.status === "denied"
            ? r.reason ?? "Geweigerd."
            : r.error ?? "Niet gelukt.",
      );
      setPending(null);
      return;
    }
    const o = data.outcome;
    if (!o) return;
    if (o.kind === "final") {
      pushAssistant(o.text || "(geen antwoord)");
      setPending(null);
    } else {
      setPending({
        tool: o.pending.tool,
        input: o.pending.input,
        summary: o.confirmation.summary,
        token: o.confirmation.token,
      });
    }
  }

  async function post(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      applyResponse((await res.json()) as ApiResponse);
    } catch {
      setError("Er ging iets mis met de verbinding.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: ChatMsg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next);
    setInput("");
    await post({ messages: next, context: { path: pathname } });
  }

  async function confirmPending() {
    if (!pending || busy) return;
    const p = pending;
    await post({ confirm: { tool: p.tool, input: p.input, token: p.token } });
  }

  function cancelPending() {
    setPending(null);
    pushAssistant("Oké, geannuleerd.");
  }

  /** 👍/👎 on assistant message i — optimistic, fire-and-forget (feedback may never block chat). */
  function sendFeedback(i: number, verdict: "up" | "down") {
    if (rated[i]) return;
    setRated((r) => ({ ...r, [i]: verdict }));
    const question = [...msgs.slice(0, i)].reverse().find((m) => m.role === "user")?.content ?? null;
    void fetch("/api/ai/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict, question, answer: msgs[i]?.content ?? "" }),
    }).catch(() => {
      // best-effort — losing one rating is fine, annoying the user is not
    });
  }

  if (!enabled) {
    return (
      <div className="rounded-lg border border-ink-200 bg-white p-4 text-sm text-ink-500">
        De assistent staat nog uit. Zet <code>AI_ENABLED=true</code> + <code>OPENAI_API_KEY</code> om hem te
        activeren.
      </div>
    );
  }

  const isWidget = variant === "widget";

  return (
    <div className={isWidget ? "flex h-full flex-col gap-3" : "space-y-3"}>
      {msgs.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={clearConversation}
            className="font-ui text-[10px] uppercase tracking-[0.15em] text-ink-400 transition hover:text-ink-700"
          >
            Gesprek wissen
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        className={`space-y-2 rounded-lg border border-ink-200 bg-white p-4 ${
          isWidget ? "flex-1 overflow-y-auto" : "min-h-[280px]"
        }`}
      >
        {msgs.length === 0 && <p className="text-sm text-ink-400">{placeholder}</p>}
        {msgs.map((m, i) => (
          <div key={`${m.role}-${i}`} className={m.role === "user" ? "text-right" : "text-left"}>
            <span
              className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-1.5 text-sm ${
                m.role === "user" ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-900"
              }`}
            >
              {m.content}
            </span>
            {m.role === "assistant" ? (
              <div className="mt-0.5 flex items-center gap-1.5">
                {rated[i] ? (
                  <span className="font-ui text-[10px] text-ink-400">
                    {rated[i] === "up" ? "✓ Bedankt!" : "✓ Bedankt — we kijken ernaar."}
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => sendFeedback(i, "up")}
                      aria-label="Goed antwoord"
                      title="Goed antwoord"
                      className="rounded px-1 text-xs text-ink-300 transition hover:text-emerald-600"
                    >
                      👍
                    </button>
                    <button
                      type="button"
                      onClick={() => sendFeedback(i, "down")}
                      aria-label="Slecht antwoord"
                      title="Slecht antwoord"
                      className="rounded px-1 text-xs text-ink-300 transition hover:text-red-600"
                    >
                      👎
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        ))}
        {pending && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="text-ink-900">{pending.summary}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={confirmPending}
                disabled={busy}
                className="rounded-md bg-ink-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Bevestig
              </button>
              <button
                type="button"
                onClick={cancelPending}
                disabled={busy}
                className="rounded-md border border-ink-300 px-3 py-1.5 text-sm text-ink-700"
              >
                Annuleer
              </button>
            </div>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          placeholder="Vraag iets…"
          className="flex-1 rounded-md border border-ink-300 bg-white px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-md bg-ink-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? "…" : "Stuur"}
        </button>
      </form>
    </div>
  );
}
