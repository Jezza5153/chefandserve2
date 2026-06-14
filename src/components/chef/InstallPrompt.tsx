"use client";

import { useEffect, useState } from "react";

/**
 * "Zet op je beginscherm" prompt. Captures the browser's beforeinstallprompt
 * event (Android/Chrome), shows a small dismissible card, and triggers the
 * native install on tap. Remembers a dismissal in localStorage so it never
 * nags. iOS Safari doesn't fire beforeinstallprompt — those users install via
 * Share → "Zet op beginscherm"; we don't show a dead button there.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
};

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("cs-install-dismissed") === "1") return;
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (hidden || !deferred) return null;

  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem("cs-install-dismissed", "1");
    } catch {
      /* private mode — fine, just won't persist */
    }
  };

  const install = async () => {
    try {
      await deferred.prompt();
    } finally {
      close();
    }
  };

  return (
    <div className="fixed inset-x-3 bottom-20 z-40 mx-auto max-w-md rounded-xl border border-ink-200 bg-white p-4 shadow-lg md:bottom-6">
      <p className="font-ui text-sm font-semibold text-ink-900">
        Zet Chef &amp; Serve op je beginscherm
      </p>
      <p className="mt-1 text-xs text-ink-600">
        Eén tik en je hebt je shifts, uren en verdiensten altijd bij de hand.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={install}
          className="rounded-full bg-burgundy px-4 py-1.5 text-xs font-medium text-white"
        >
          Toevoegen
        </button>
        <button
          type="button"
          onClick={close}
          className="rounded-full px-4 py-1.5 text-xs text-ink-600"
        >
          Niet nu
        </button>
      </div>
    </div>
  );
}
