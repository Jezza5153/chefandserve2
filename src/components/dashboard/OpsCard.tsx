/**
 * OpsCard — actionable KPI tile for the cockpit. A number that answers "why it
 * matters" + a click target. Replaces the cold stat tile: every card is a Link.
 */

import Link from "next/link";

import { Icon, type IconName } from "@/components/admin/icons";

type LineTone = "ink" | "muted" | "emerald" | "amber" | "blue" | "red";

const LINE_CLASS: Record<LineTone, string> = {
  ink: "text-ink-900",
  muted: "text-ink-500",
  emerald: "text-emerald-700",
  amber: "text-amber-800",
  blue: "text-blue-700",
  red: "text-red-700",
};

export function OpsCard({
  icon,
  label,
  value,
  lines = [],
  href,
  cta = "Bekijken",
  badge,
}: {
  icon: IconName;
  label: string;
  value: string | number;
  lines?: { text: string; tone?: LineTone }[];
  href: string;
  cta?: string;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-[44px] flex-col rounded-xl border border-ink-200 bg-white p-4 transition-colors hover:border-burgundy/40"
    >
      <p className="flex items-center gap-1.5 font-ui text-[11px] uppercase tracking-[0.14em] text-ink-500">
        <Icon name={icon} className="h-4 w-4" />
        {label}
        {typeof badge === "number" && badge > 0 && (
          <span className="rounded-full bg-burgundy px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {badge}
          </span>
        )}
      </p>
      <p className="mt-2 font-serif text-3xl text-ink-900">{value}</p>
      {lines.map((l, i) => (
        <p key={i} className={`text-[12px] ${LINE_CLASS[l.tone ?? "ink"]}`}>
          {l.text}
        </p>
      ))}
      <span className="mt-2 flex items-center gap-1 font-ui text-[11px] font-medium text-burgundy group-hover:underline">
        {cta}
        <Icon name="arrow-right" className="h-3.5 w-3.5" />
      </span>
    </Link>
  );
}
