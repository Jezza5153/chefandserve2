/**
 * ActionCard — PR-CHEF-2.
 *
 * The "wat moet ik nu doen?" primitive used by all 3 daily dashboards
 * (chef · klant · admin). One card answers ONE question: what should this
 * person do, and how many of these are waiting?
 *
 * Variants:
 *   - default: neutral border, gray emoji background
 *   - urgent: amber tint (action waiting)
 *   - critical: burgundy tint (overdue / problem)
 *   - success: green tint (no action needed — informational good news)
 *
 * Composable: pass children for a small inline list, OR pass count + label
 * + ctaHref for a one-glance card.
 */

import Link from "next/link";

type Tone = "default" | "urgent" | "critical" | "success";

export function ActionCard({
  icon,
  title,
  subtitle,
  count,
  ctaLabel,
  ctaHref,
  tone = "default",
  children,
}: {
  icon: string; // emoji or short symbol like "⏰", "✅", "📝"
  title: string;
  /** Optional "wat gebeurt er nu?" next-step line under the title. */
  subtitle?: string;
  count?: number;
  ctaLabel?: string;
  ctaHref?: string;
  tone?: Tone;
  children?: React.ReactNode;
}) {
  const cls =
    tone === "urgent"
      ? "border-amber-300 bg-amber-50"
      : tone === "critical"
        ? "border-burgundy/40 bg-burgundy/5"
        : tone === "success"
          ? "border-emerald-200 bg-emerald-50"
          : "border-ink-200 bg-white";

  return (
    <div className={`rounded-lg border p-5 ${cls}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span aria-hidden className="text-xl leading-none">
            {icon}
          </span>
          <div>
            <h3 className="font-serif text-base text-ink-900">{title}</h3>
            {subtitle ? <p className="mt-1 text-xs text-ink-600">{subtitle}</p> : null}
            {typeof count === "number" ? (
              <p className="mt-1 font-mono text-2xl leading-tight text-ink-900">
                {count}
              </p>
            ) : null}
          </div>
        </div>
        {ctaLabel && ctaHref ? (
          <Link
            href={ctaHref}
            className="rounded-full bg-burgundy px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900"
          >
            {ctaLabel}
          </Link>
        ) : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

/**
 * Small sublist row used inside ActionCard children.
 */
export function ActionRow({
  label,
  meta,
  href,
  cta,
}: {
  label: string;
  meta?: string;
  href?: string;
  cta?: string;
}) {
  const content = (
    <>
      <div className="min-w-0">
        <p className="truncate text-sm text-ink-900">{label}</p>
        {meta ? <p className="text-xs text-ink-500">{meta}</p> : null}
      </div>
      {cta ? (
        <span className="shrink-0 font-ui text-[10px] uppercase tracking-[0.15em] text-burgundy">
          {cta}
        </span>
      ) : null}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="flex items-center justify-between gap-3 rounded px-2 py-2 hover:bg-burgundy/5"
      >
        {content}
      </Link>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 px-2 py-2">
      {content}
    </div>
  );
}
