"use client";

import { useState } from "react";

import { AssistantChat } from "@/components/ai/AssistantChat";

/**
 * Floating owner-assistant launcher, mounted in the admin shell so the assistant is
 * reachable on every admin page — not just /admin/assistant. Same brain + tools + confirm
 * gate; this is purely a second UI surface. The layout only mounts it for owner /
 * super_admin when AI is enabled, so here we always render the live chat.
 */
export function AssistantWidget() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3 print:hidden">
      {open && (
        <div className="flex h-[520px] max-h-[calc(100vh-7rem)] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl border border-ink-200 bg-bg-gray shadow-2xl">
          <div className="flex items-center justify-between border-b border-ink-200 bg-white px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-burgundy text-white">
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                  <path d="M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2Z" />
                </svg>
              </span>
              <div>
                <p className="text-[13px] font-medium leading-tight text-ink-900">Assistent</p>
                <p className="font-ui text-[10px] uppercase leading-tight tracking-[0.16em] text-ink-500">
                  Je rechterhand
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Assistent sluiten"
              className="rounded-md p-1 text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-hidden p-3">
            <AssistantChat enabled variant="widget" />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Assistent sluiten" : "Assistent openen"}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-burgundy text-white shadow-lg transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-burgundy focus-visible:ring-offset-2"
      >
        {open ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7.5 9h9M7.5 12.5h6M21 12a8.5 8.5 0 0 1-12.4 7.55L3 21l1.45-5.6A8.5 8.5 0 1 1 21 12Z"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
