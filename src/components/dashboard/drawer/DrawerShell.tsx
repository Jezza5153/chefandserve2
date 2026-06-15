"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The dashboard drawer overlay — a mini-workbench, not a detail page. Right-side
 * panel on desktop (~480px), full-screen bottom-sheet on mobile with a sticky
 * header. Backdrop click + Escape close it by navigating back to `closeHref`
 * (which clears the ?drawer= param, so the server-rendered drawer unmounts and
 * the dashboard behind it is shown again). Body scroll is locked while open.
 *
 * Content is server-rendered and passed as children — this shell is pure chrome.
 */
export function DrawerShell({
  title,
  closeHref,
  children,
}: {
  title: string;
  closeHref: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(closeHref, { scroll: false });
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [closeHref, router]);

  const close = () => router.push(closeHref, { scroll: false });

  return (
    <div className="fixed inset-0 z-50 print:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Sluiten" onClick={close} className="absolute inset-0 bg-ink-900/30 backdrop-blur-[1px]" />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[90vh] flex-col rounded-t-2xl border-t border-ink-200 bg-bg-gray shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[480px] md:rounded-none md:border-l md:border-t-0">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-200 bg-white px-5 py-4">
          <p className="min-w-0 flex-1 truncate font-serif text-lg text-ink-900">{title}</p>
          <button
            type="button"
            onClick={close}
            aria-label="Sluiten"
            className="ml-3 shrink-0 rounded-md p-1.5 text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
