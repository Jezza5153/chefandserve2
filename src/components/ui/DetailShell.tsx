/**
 * DetailShell / DetailSection — UX foundation. The standard admin detail-page skeleton,
 * extracted from the repeated pattern in the chefs/clients/shifts [id] pages: a back-link +
 * serif title header, and the rounded-border section card with an optional eyebrow + action.
 * `className` lets the adopting page keep its exact container width (so adoption is a
 * zero-layout-change refactor). Server-safe.
 */
import Link from "next/link";
import type { ReactNode } from "react";

export function DetailShell({
  backHref,
  backLabel,
  eyebrow,
  title,
  actions,
  children,
  className = "mx-auto max-w-5xl",
}: {
  backHref: string;
  backLabel: string;
  eyebrow?: string;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={backHref}
            className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
          >
            ← {backLabel}
          </Link>
          {eyebrow ? (
            <p className="mt-2 font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">{eyebrow}</p>
          ) : null}
          <h1 className="mt-1 font-serif text-3xl text-ink-900 md:text-4xl">{title}</h1>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function DetailSection({
  title,
  eyebrow,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mt-6 rounded-lg border border-ink-200 bg-white p-5 ${className}`}>
      {title || eyebrow || action ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            {eyebrow ? (
              <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">{eyebrow}</p>
            ) : null}
            {title ? <h2 className="font-serif text-lg text-ink-900">{title}</h2> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
