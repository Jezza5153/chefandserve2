/**
 * Business read-model — the assistant's "eyes". Composes the existing platform
 * rollups + planner cockpit + a live chef-roster headcount into one snapshot the
 * assistant grounds answers on. Read-only; every number traces to a real query.
 *
 * Note the two distinct chef numbers — keeping them separate stops the assistant from
 * confusing "how many chefs do I have" with "how many worked recently":
 *   - chefs.active     : roster headcount with status = 'active' (what "hoeveel chefs heb
 *                        ik" means; mirrors the /admin/business/chefs ACTIEF tab).
 *   - chefsWhoWorked   : chefs who actually logged hours in the fill window (a capacity
 *                        signal — 0 when nothing has been worked yet).
 */
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import { getPlatformRollups, type FillBreakdown, type MoneyWindow } from "@/lib/domain/platform-rollups";
import { getPlannerCockpit } from "@/lib/domain/planner-intel";

const euro = (cents: number): string =>
  "€" + (cents / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type BusinessSnapshot = {
  headline: string;
  chefs: { active: number; total: number };
  money: { week: MoneyWindow; month: MoneyWindow; ytd: MoneyWindow };
  fill: { overallFilled: number; overallSlots: number; byRole: FillBreakdown[] };
  chefsWhoWorked: number;
  workedHours: number;
  ops: {
    intakeTotal: number;
    acceptedUnconfirmed: number;
    open48hSlots: number;
    open7dCount: number;
  };
};

export async function getBusinessSnapshot(): Promise<BusinessSnapshot> {
  const [r, c, activeRow, totalRow] = await Promise.all([
    getPlatformRollups(),
    getPlannerCockpit(),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(chefs)
      .where(and(isNull(chefs.deletedAt), eq(chefs.status, "active"))),
    db.select({ n: sql<number>`count(*)::int` }).from(chefs).where(isNull(chefs.deletedAt)),
  ]);

  const roster = { active: activeRow[0]?.n ?? 0, total: totalRow[0]?.n ?? 0 };

  const headline =
    `${roster.active} actieve chefs op de rol (van ${roster.total} totaal). ` +
    `Deze maand: omzet ${euro(r.month.revenueCents)}, marge ${euro(r.month.marginCents)}. ` +
    `Bezetting ${r.overallFill.filled}/${r.overallFill.slots}. ` +
    `${c.open48hSlots} open binnen 48u, ${c.acceptedUnconfirmed} geaccepteerd maar niet bevestigd, ` +
    `${c.intake.total} in intake.`;

  return {
    headline,
    chefs: roster,
    money: { week: r.week, month: r.month, ytd: r.ytd },
    fill: { overallFilled: r.overallFill.filled, overallSlots: r.overallFill.slots, byRole: r.fillByRole },
    chefsWhoWorked: r.activeChefs,
    workedHours: r.workedHours,
    ops: {
      intakeTotal: c.intake.total,
      acceptedUnconfirmed: c.acceptedUnconfirmed,
      open48hSlots: c.open48hSlots,
      open7dCount: c.open7dCount,
    },
  };
}
