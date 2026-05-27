"use client";

import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile widget. Lazy-loads the Turnstile script once,
 * renders the challenge into a hidden div, and writes the token into a
 * hidden form field named `cf-turnstile-response` (what the server reads).
 *
 * Single-use semantics: token expires after 300s. If the form sits idle
 * longer than that, the user has to re-challenge — Turnstile handles this
 * with its built-in expired-callback hook.
 *
 * When the site key isn't configured (env var missing) → render nothing.
 * Login still works; the server-side `verifyTurnstileToken` returns ok-true
 * when not configured.
 */
type TurnstileGlobal = {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
      theme?: "light" | "dark" | "auto";
    },
  ) => string;
  remove?: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileGlobal;
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export function TurnstileWidget({ siteKey }: { siteKey: string | undefined }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;

    let cancelled = false;

    function ensureScript(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (window.turnstile) return resolve();
        const existing = document.querySelector(`script[src="${SCRIPT_URL}"]`) as HTMLScriptElement | null;
        if (existing) {
          existing.addEventListener("load", () => resolve());
          existing.addEventListener("error", () => reject(new Error("turnstile script failed to load")));
          return;
        }
        const s = document.createElement("script");
        s.src = SCRIPT_URL;
        s.async = true;
        s.defer = true;
        s.addEventListener("load", () => resolve());
        s.addEventListener("error", () => reject(new Error("turnstile script failed to load")));
        document.head.appendChild(s);
      });
    }

    ensureScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => {
            if (tokenRef.current) tokenRef.current.value = token;
          },
          "expired-callback": () => {
            if (tokenRef.current) tokenRef.current.value = "";
          },
          "error-callback": () => {
            if (tokenRef.current) tokenRef.current.value = "";
          },
          theme: "light",
        });
      })
      .catch(() => {
        // Script load failure: leave token empty so the server-side check
        // can reject the submission with a clear error. We don't surface
        // anything to the UI here — the server-side error handling does that.
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile?.remove) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* widget may have been GC'd already */
        }
      }
    };
  }, [siteKey]);

  // No site key configured → don't render the widget container. The hidden
  // input still exists (empty value) so the server action's form-data read
  // doesn't error.
  if (!siteKey) {
    return <input type="hidden" name="cf-turnstile-response" defaultValue="" />;
  }

  return (
    <div className="mt-4">
      <div ref={containerRef} aria-label="Cloudflare beveiligingscontrole" />
      <input
        ref={tokenRef}
        type="hidden"
        name="cf-turnstile-response"
        defaultValue=""
      />
    </div>
  );
}
