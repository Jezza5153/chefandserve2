"use client";

/**
 * AutoRefresh — keeps a force-dynamic server page quietly current (planner workbench: a shift
 * filled by a colleague disappears within a minute, no F5). router.refresh() re-renders the
 * server component in place WITHOUT touching client state (the assistant widget keeps its chat).
 * Only ticks while the tab is visible; pauses in background tabs.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({
  seconds = 60,
  clearParam,
}: {
  seconds?: number;
  /** Query param (e.g. an "ok" toast flag) to strip ~6s after mount — otherwise the sticky
   *  toast outlives its action and contradicts the auto-refreshed list (review finding). */
  clearParam?: string;
}) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, Math.max(15, seconds) * 1000);

    let clearId: ReturnType<typeof setTimeout> | undefined;
    if (clearParam) {
      const url = new URL(window.location.href);
      if (url.searchParams.has(clearParam)) {
        clearId = setTimeout(() => {
          url.searchParams.delete(clearParam);
          router.replace(url.pathname + (url.searchParams.size ? `?${url.searchParams}` : ""));
        }, 6000);
      }
    }
    return () => {
      clearInterval(id);
      if (clearId) clearTimeout(clearId);
    };
  }, [router, seconds, clearParam]);
  return null;
}
