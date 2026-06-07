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
import { StatusBadge } from "@/components/ui/StatusBadge";

/** Thin wrapper: maps a shift_hours status to a tone + Dutch label, renders via the shared StatusBadge. */
export function HumanStatusBadge({ status }: { status: HoursStatus }) {
  return <StatusBadge tone={statusTone(status)} label={humanStatus(status)} />;
}
