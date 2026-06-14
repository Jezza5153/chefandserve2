"use client";

import { useEffect } from "react";

/**
 * Registers the chef portal service worker (/sw.js, scope /chef). Mounted only
 * inside the chef layout, so it's already chef-scoped. Best-effort: silent on
 * unsupported browsers or registration failure (the portal works without it —
 * the SW only adds installability + offline shell + a push receiver).
 */
export function PwaRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/chef" }).catch(() => {});
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
