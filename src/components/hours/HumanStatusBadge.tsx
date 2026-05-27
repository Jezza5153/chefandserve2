/**
 * HumanStatusBadge — PR-CHEF-1.
 *
 * Small pill rendering the Dutch label for a shift_hours status. Use this
 * everywhere a status is shown inline (queue rows, list items, chef
 * dashboard cards).
 *
 * NEVER stringify a raw status in JSX — always go through this component
 * or humanStatus() from hours-labels.ts.
 */

import { humanStatus, statusTone, type HoursStatus } from "@/lib/hours-labels";

export function HumanStatusBadge({ status }: { status: HoursStatus }) {
  const tone = statusTone(status);
  const cls =
    tone === "green"
      ? "bg-emerald-100 text-emerald-700"
      : tone === "amber"
        ? "bg-amber-100 text-amber-800"
        : tone === "blue"
          ? "bg-blue-100 text-blue-700"
          : tone === "burgundy"
            ? "bg-burgundy/10 text-burgundy"
            : "bg-bg-gray text-ink-500";
  return (
    <span
      className={`rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${cls}`}
    >
      {humanStatus(status)}
    </span>
  );
}
