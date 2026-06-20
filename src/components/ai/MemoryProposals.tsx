"use client";

import { useEffect, useState } from "react";

/**
 * "Zal ik dit onthouden?" — the owner's one-click accept for facts the nightly miner overheard
 * (audit gap #4). Renders above the assistant chat ONLY when memory-mining is enabled; otherwise
 * it fetches nothing and shows nothing. Onthoud → the exact fact goes into owner-memory; Nee →
 * dismissed. No proposals → the panel renders nothing (no empty box).
 */
type Proposal = { id: string; fact: string; createdAt: string };

export function MemoryProposals({ enabled }: { enabled: boolean }) {
  const [items, setItems] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void fetch("/api/ai/memory-proposals")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { proposals?: Proposal[] } | null) => {
        if (alive && d && Array.isArray(d.proposals)) setItems(d.proposals);
      })
      .catch(() => {
        // best-effort — a missing surface just shows nothing
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  async function decide(id: string, action: "accept" | "dismiss") {
    if (busy[id]) return;
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const res = await fetch("/api/ai/memory-proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = (await res.json()) as { ok?: boolean; deduped?: boolean; error?: string };
      if (data.ok) {
        setItems((xs) => xs.filter((x) => x.id !== id));
        if (action === "accept") setNote(data.deduped ? "Stond al in mijn geheugen." : "Onthouden ✓");
      } else {
        setNote(data.error ?? "Niet gelukt.");
        // already-decided → drop it from the list so it can't be re-clicked
        if (res.status === 409) setItems((xs) => xs.filter((x) => x.id !== id));
      }
    } catch {
      setNote("Verbinding mislukt.");
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  if (!enabled || items.length === 0) {
    return note ? <p className="text-right font-ui text-[11px] text-ink-400">{note}</p> : null;
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="font-ui text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-800">
        Zal ik dit onthouden?
      </p>
      <p className="mt-0.5 text-[11px] text-amber-700">
        Uit je recente gesprekken. Onthoud wat blijvend klopt — de rest negeer je.
      </p>
      <ul className="mt-2 space-y-1.5">
        {items.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-white px-2.5 py-1.5"
          >
            <span className="min-w-0 flex-1 text-sm text-ink-900">{p.fact}</span>
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                disabled={busy[p.id]}
                onClick={() => decide(p.id, "accept")}
                className="rounded-full bg-burgundy px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-white hover:bg-burgundy-900 disabled:opacity-50"
              >
                Onthoud
              </button>
              <button
                type="button"
                disabled={busy[p.id]}
                onClick={() => decide(p.id, "dismiss")}
                className="rounded-full border border-ink-300 px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-ink-600 hover:bg-ink-50 disabled:opacity-50"
              >
                Nee
              </button>
            </div>
          </li>
        ))}
      </ul>
      {note ? <p className="mt-1.5 text-right font-ui text-[11px] text-ink-500">{note}</p> : null}
    </div>
  );
}
