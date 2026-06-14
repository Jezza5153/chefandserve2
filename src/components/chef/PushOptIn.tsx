"use client";

import { useEffect, useState } from "react";

/**
 * Web Push opt-in (CHEF-14). Asks for notification permission, subscribes via
 * the service worker (registered by PwaRegistrar), and sends the subscription
 * to the server action. iOS only supports push once the PWA is installed to the
 * home screen — there we show install guidance instead of a dead button.
 */
type SubArgs = { endpoint: string; p256dh: string; auth: string; userAgent: string };

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type State = "loading" | "unsupported" | "ios-install" | "default" | "granted" | "denied";

export function PushOptIn({
  vapidKey,
  subscribeAction,
  idleText = "Zet meldingen aan en je krijgt een seintje op je telefoon zodra er een nieuwe shift of urenvraag is.",
  grantedText = "✓ Meldingen staan aan. Je krijgt een seintje op je telefoon bij een nieuwe shift of urenvraag.",
}: {
  vapidKey: string;
  subscribeAction: (sub: SubArgs) => Promise<void>;
  /** Audience-specific copy (defaults are chef-flavored; klant passes its own). */
  idleText?: string;
  grantedText?: string;
}) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isIOS && !standalone) {
      setState("ios-install");
      return;
    }
    setState(Notification.permission as State);
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm as State);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } };
      if (json.keys?.p256dh && json.keys?.auth) {
        await subscribeAction({
          endpoint: sub.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          userAgent: navigator.userAgent,
        });
        setState("granted");
      }
    } catch {
      /* user dismissed / browser refused — leave state as-is */
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading" || state === "unsupported") return null;

  return (
    <div className="mb-6 rounded-lg border border-ink-200 bg-white p-4">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Meldingen</p>
      {state === "granted" ? (
        <p className="mt-1 text-sm text-ink-700">{grantedText}</p>
      ) : state === "ios-install" ? (
        <p className="mt-1 text-sm text-ink-700">
          Voeg Chef &amp; Serve eerst toe aan je beginscherm (deel-icoon →
          &quot;Zet op beginscherm&quot;). Daarna kun je meldingen aanzetten.
        </p>
      ) : state === "denied" ? (
        <p className="mt-1 text-sm text-ink-700">
          Meldingen staan geblokkeerd. Zet ze aan via de browser-instellingen voor deze site.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-700">{idleText}</p>
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="mt-3 rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy/90 disabled:opacity-50"
          >
            {busy ? "Bezig…" : "Meldingen aanzetten"}
          </button>
        </>
      )}
    </div>
  );
}
