/**
 * Business read-model — the assistant's "eyes". Composes the existing platform
 * rollups + planner cockpit into one snapshot the assistant grounds answers on.
 * Read-only; every number traces to a real query.
 */
import { getPlatformRollups, type FillBreakdown, type MoneyWindow } from "@/lib/domain/platform-rollups";
import { getPlannerCockpit } from "@/lib/domain/planner-intel";

const euro = (cents: number): string =>
  "€" + (cents / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type BusinessSnapshot = {
  headline: string;
  money: { week: MoneyWindow; month: MoneyWindow; ytd: MoneyWindow };
  fill: { overallFilled: number; overallSlots: number; byRole: FillBreakdown[] };
  activeChefs: number;
  workedHours: number;
  ops: {
    intakeTotal: number;
    acceptedUnconfirmed: number;
    open48hSlots: number;
    open7dCount: number;
  };
};

export async function getBusinessSnapshot(): Promise<BusinessSnapshot> {
  const [r, c] = await Promise.all([getPlatformRollups(), getPlannerCockpit()]);
  const headline =
    `Deze maand: omzet ${euro(r.month.revenueCents)}, marge ${euro(r.month.marginCents)}. ` +
    `Bezetting ${r.overallFill.filled}/${r.overallFill.slots}. ` +
    `${c.open48hSlots} open binnen 48u, ${c.acceptedUnconfirmed} geaccepteerd maar niet bevestigd, ` +
    `${c.intake.total} in intake.`;
  return {
    headline,
    money: { week: r.week, month: r.month, ytd: r.ytd },
    fill: { overallFilled: r.overallFill.filled, overallSlots: r.overallFill.slots, byRole: r.fillByRole },
    activeChefs: r.activeChefs,
    workedHours: r.workedHours,
    ops: {
      intakeTotal: c.intake.total,
      acceptedUnconfirmed: c.acceptedUnconfirmed,
      open48hSlots: c.open48hSlots,
      open7dCount: c.open7dCount,
    },
  };
}
