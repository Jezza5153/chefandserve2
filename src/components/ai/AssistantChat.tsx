"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { ShortlistEnvelope } from "@/lib/shortlist-envelope";

// P5a-2: an assistant message may carry a shortlist (owner channel only) → action rows.
// #7: a `hidden` "system" message carries a confirmed-action memo — sent to the model (so it
// can chain off the result), never rendered in the chat.
type ChatMsg = {
  role: "user" | "assistant" | "system";
  content: string;
  shortlist?: ShortlistEnvelope;
  hidden?: boolean;
};
type Pending = { tool: string; input: unknown; summary: string; token: string; risk?: string };
// Per-(shift,chef) state of a "Stel voor" click.
type ActionState = { state: "busy" | "done" | "err"; message?: string };

type ApiResponse = {
  disabled?: boolean;
  message?: string;
  error?: string;
  outcome?:
    | { kind: "final"; text: string }
    | {
        kind: "awaiting_confirmation";
        confirmation: { summary: string; token: string; risk?: string };
        pending: { tool: string; input: unknown };
      };
  result?: { status: string; summary?: string; reason?: string; error?: string };
  /** #7: model-legible memo of the just-confirmed action — threaded into history (hidden). */
  memo?: string;
  /** P5a-2: AVG-safe action shortlist for the owner chat (present only on the owner channel). */
  shortlist?: ShortlistEnvelope;
};

/** Map the action's risk tier → a consequence-legible badge in the confirm-gate. */
function riskBadge(risk?: string): { label: string; cls: string } | null {
  switch (risk) {
    case "financial":
      return { label: "Financieel — onomkeerbaar", cls: "bg-red-100 text-red-800" };
    case "outbound":
      return { label: "Verstuurt een bericht", cls: "bg-orange-100 text-orange-800" };
    case "self":
      return { label: "Wijziging", cls: "bg-amber-100 text-amber-800" };
    default:
      return null;
  }
}

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

  // Quick-ask (wave W2): a page chip dispatches `cs-ai:ask` with the question — prefill the
  // input (NEVER auto-send: the human presses verstuur, consistent with the confirm culture).
  useEffect(() => {
    const onAsk = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt;
      if (typeof prompt === "string" && prompt.trim()) setInput(prompt);
    };
    window.addEventListener("cs-ai:ask", onAsk);
    return () => window.removeEventListener("cs-ai:ask", onAsk);
  }, []);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 👍/👎 per assistant-message index — the learning loop's intake (POST /api/ai/feedback).
  const [rated, setRated] = useState<Record<number, "up" | "down">>({});
  // P5a-2: "Stel voor" click state, keyed `${shiftId}:${chefId}` (one propose per pair).
  const [actioned, setActioned] = useState<Record<string, ActionState>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

  // Persist the conversation per channel so closing the widget or navigating pages
  // (both unmount this component) doesn't wipe the chat. sessionStorage = survives within
  // the tab/session, resets on a fresh tab — the right lifetime for a chat.
  const storageKey = `ai-chat:${endpoint}`;
  const skipFirstSave = useRef(true);
  useEffect(() => {
    let hadLocal = false;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as {
          msgs?: ChatMsg[];
          pending?: Pending | null;
          rated?: Record<number, "up" | "down">;
        };
        if (Array.isArray(saved.msgs) && saved.msgs.length > 0) {
          setMsgs(saved.msgs);
          hadLocal = true;
        }
        if (saved.pending) setPending(saved.pending);
        if (saved.rated && typeof saved.rated === "object") setRated(saved.rated);
      }
    } catch {
      // ignore corrupt/blocked storage
    }
    // Fresh tab/device (no local copy) → pick the conversation back up from the server mirror.
    if (!hadLocal) {
      void fetch("/api/ai/conversation")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { messages?: ChatMsg[] } | null) => {
          if (d && Array.isArray(d.messages) && d.messages.length > 0) setMsgs(d.messages);
        })
        .catch(() => {
          // best-effort — no server copy is fine
        });
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
    // Mirror to the server (debounced, fire-and-forget) so other tabs/devices can resume.
    // Drop hidden #7 confirmed-action memos: they're a within-session chaining aid (sessionStorage
    // keeps them for THIS tab), and the mirror only stores user/assistant turns — a "system" role
    // would make the whole save bounce as Bad Request.
    if (syncTimer.current) clearTimeout(syncTimer.current);
    const mirror = msgs.filter((m) => !m.hidden);
    if (mirror.length > 0) {
      syncTimer.current = setTimeout(() => {
        void fetch("/api/ai/conversation", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: mirror }),
        }).catch(() => {
          // best-effort
        });
      }, 1200);
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
    setActioned({});
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    if (syncTimer.current) clearTimeout(syncTimer.current); // don't let a pending sync resurrect it
    void fetch("/api/ai/conversation", { method: "DELETE" }).catch(() => {
      // best-effort
    });
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
      const summary =
        r.status === "ok"
          ? r.summary ?? "Gedaan."
          : r.status === "denied"
            ? r.reason ?? "Geweigerd."
            : r.error ?? "Niet gelukt.";
      // Visible summary for the human + a hidden "system" memo (#7) carrying the structured
      // result (new id's etc.) so the model can chain off it next turn instead of going blind.
      setMsgs((m) => [
        ...m,
        { role: "assistant", content: summary },
        ...(data.memo ? [{ role: "system" as const, content: data.memo, hidden: true }] : []),
      ]);
      setPending(null);
      return;
    }
    const o = data.outcome;
    if (!o) return;
    if (o.kind === "final") {
      // Attach the action shortlist (if any) to this assistant message so its rows render
      // right under the answer.
      setMsgs((m) => [...m, { role: "assistant", content: o.text || "(geen antwoord)", shortlist: data.shortlist }]);
      setPending(null);
    } else {
      setPending({
        tool: o.pending.tool,
        input: o.pending.input,
        summary: o.confirmation.summary,
        token: o.confirmation.token,
        risk: o.confirmation.risk,
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

  /** P5a-2: "Stel voor" on a shortlist row → the SAME audited propose the fill-drawer uses
   *  (owner channel, behind AI_SHORTLIST_ACTIONS_ENABLED). The deliberate click is the
   *  confirmation; the mutation is idempotent (already_proposed) so a re-click is harmless. */
  async function proposeFromShortlist(rowKey: string, shiftId: string, chefId: string, score: number) {
    const k = rowKey;
    if (actioned[k]?.state === "busy" || actioned[k]?.state === "done") return;
    setActioned((a) => ({ ...a, [k]: { state: "busy" } }));
    try {
      const res = await fetch("/api/ai/shortlist/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftId, chefId, matchScore: score }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      setActioned((a) => ({
        ...a,
        [k]: { state: data.ok ? "done" : "err", message: data.message ?? (data.ok ? "Voorgesteld." : "Niet gelukt.") },
      }));
    } catch {
      setActioned((a) => ({ ...a, [k]: { state: "err", message: "Verbinding mislukt." } }));
    }
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
        {msgs.map((m, i) =>
          // #7: hidden confirmed-action memos go to the model, never to the screen. Returning
          // null (rather than filtering) keeps `i` aligned with the rating/feedback map.
          m.hidden ? null : (
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
            {/* P5a-2: action shortlist — one row per chef with a "Stel voor" button that runs
                the same audited propose the fill-drawer uses. Owner channel only. */}
            {m.role === "assistant" && m.shortlist && m.shortlist.items.length > 0 ? (
              <div className="mt-1.5 space-y-1.5 text-left">
                {m.shortlist.items.map((it) => {
                  // Key by message index too, so the same (shift,chef) re-suggested in a
                  // later message gets its own click state instead of inheriting this row's.
                  const k = `${i}:${m.shortlist!.shiftId}:${it.chefId}`;
                  const st = actioned[k];
                  return (
                    <div
                      key={it.chefId}
                      className="flex items-center justify-between gap-2 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <span className="text-sm text-ink-900">{it.chefName}</span>
                        <span className="ml-1.5 rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-600">
                          score {it.score}
                        </span>
                        {it.reason ? <p className="truncate text-[11px] text-ink-500">{it.reason}</p> : null}
                        {it.warning ? <p className="truncate text-[11px] text-amber-700">⚠ {it.warning}</p> : null}
                      </div>
                      {st?.state === "done" ? (
                        <span className="shrink-0 text-[11px] text-emerald-700">✓ {st.message}</span>
                      ) : st?.state === "err" ? (
                        <span className="shrink-0 text-[11px] text-red-600">{st.message}</span>
                      ) : (
                        <button
                          type="button"
                          disabled={st?.state === "busy"}
                          onClick={() => proposeFromShortlist(k, m.shortlist!.shiftId, it.chefId, it.score)}
                          className="shrink-0 rounded-full bg-burgundy px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-white hover:bg-burgundy-900 disabled:opacity-50"
                        >
                          {st?.state === "busy" ? "…" : "Stel voor"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ))}
        {busy && !pending && msgs[msgs.length - 1]?.role === "user" && (
          <div className="text-left" aria-live="polite">
            <span className="inline-flex items-center gap-1 rounded-lg bg-ink-100 px-3 py-2 text-sm text-ink-500">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-400 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-400 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-400" />
            </span>
          </div>
        )}
        {pending && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              pending.risk === "financial" ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"
            }`}
          >
            {(() => {
              const badge = riskBadge(pending.risk);
              return badge ? (
                <span className={`mb-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.cls}`}>
                  {badge.label}
                </span>
              ) : null;
            })()}
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
