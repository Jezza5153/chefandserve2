/**
 * Daily briefing ("dagstart") — the owner's morning picture in plain Dutch:
 *   • GISTEREN — diensten gedraaid, uren die nog niet rond zijn ("hotel moet nog tekenen" /
 *     "chef moet nog indienen" / "afgekeurd"), en nieuwe opmerkingen van hotels.
 *   • VANDAAG — diensten op de planning (+ open plekken), uren die op goedkeuring wachten,
 *     en documenten die binnenkort verlopen.
 *
 * Drives BOTH the on-demand `briefing.daily` tool AND the proactive morning push
 * (`/api/cron/daily-briefing` → in-app melding + e-mail + [gated] WhatsApp). The text is
 * DETERMINISTIC (no LLM), so the cron needs no OpenAI key and the output never drifts.
 * Read-only, owner-scoped (the owner spans all tenants).
 */
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, placementComments, shiftHours, shifts } from "@/lib/db/schema";
import { addDaysToKey, amsterdamDayKey, amsterdamMidnightUtc } from "@/lib/roster-format";
import { expiringDocumentsForAi } from "@/lib/ai/read-model/oversight";
import { listHoursAwaitingApproval } from "@/lib/ai/read-model/hours";

/** Unresolved hours statuses, in plain Dutch — what's blocking each row from being "rond". */
const HOURS_PROBLEM_NL: Record<string, string> = {
  draft: "chef moet nog indienen",
  submitted: "hotel moet nog tekenen",
  client_rejected: "afgekeurd door hotel",
};
const PROBLEM_STATUSES = ["draft", "submitted", "client_rejected"] as const;

const dutchDate = (d: Date) =>
  new Date(d).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
const snippet = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n).trim()}…` : s);
const names = (xs: (string | null)[], max = 3) => {
  const u = [...new Set(xs.filter((x): x is string => !!x))];
  return u.length <= max ? u.join(", ") : `${u.slice(0, max).join(", ")} +${u.length - max}`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type DailyBriefing = {
  /** Today's Amsterdam day key (YYYY-MM-DD). */
  date: string;
  /** Rendered Dutch briefing — goes into the notification body / email / WhatsApp. */
  text: string;
  /** True if anything needs attention (lets the cron skip "quiet day" sends if configured). */
  hasUrgent: boolean;
  /** Structured counts (for the tool's data payload + tests). */
  data: {
    yesterday: { shifts: number; unresolvedHours: number; newClientComments: number };
    today: { shifts: number; openShifts: number; hoursAwaitingApproval: number; expiringDocs: number };
  };
};

export async function buildDailyBriefing(now: Date): Promise<DailyBriefing> {
  const todayKey = amsterdamDayKey(now);
  const yStart = amsterdamMidnightUtc(addDaysToKey(todayKey, -1));
  const weekAgo = amsterdamMidnightUtc(addDaysToKey(todayKey, -7));
  const tStart = amsterdamMidnightUtc(todayKey);
  const tEnd = amsterdamMidnightUtc(addDaysToKey(todayKey, 1));

  const [yShifts, problemRows, newComments, tShifts, awaiting, expiring] = await Promise.all([
    // Yesterday — shifts that ran
    db
      .select({ client: clients.companyName })
      .from(shifts)
      .leftJoin(clients, eq(clients.id, shifts.clientId))
      .where(and(gte(shifts.startsAt, yStart), lt(shifts.startsAt, tStart))),
    // Past week — hours still not through (the "missing hours")
    db
      .select({ status: shiftHours.status, chef: chefs.fullName, client: clients.companyName })
      .from(shiftHours)
      .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
      .leftJoin(chefs, eq(chefs.id, shiftHours.chefId))
      .leftJoin(clients, eq(clients.id, shiftHours.clientId))
      .where(
        and(
          lt(shifts.startsAt, tStart),
          gte(shifts.startsAt, weekAgo),
          inArray(shiftHours.status, [...PROBLEM_STATUSES]),
        ),
      )
      .orderBy(desc(shifts.startsAt))
      .limit(25),
    // New hotel comments since the start of yesterday
    db
      .select({ body: placementComments.body, at: placementComments.createdAt })
      .from(placementComments)
      .where(and(eq(placementComments.authorKind, "client"), gte(placementComments.createdAt, yStart)))
      .orderBy(desc(placementComments.createdAt))
      .limit(5),
    // Today — shifts on the planning
    db
      .select({ status: shifts.status, client: clients.companyName })
      .from(shifts)
      .leftJoin(clients, eq(clients.id, shifts.clientId))
      .where(and(gte(shifts.startsAt, tStart), lt(shifts.startsAt, tEnd))),
    listHoursAwaitingApproval(),
    expiringDocumentsForAi({ days: 14, limit: 5 }),
  ]);

  const openToday = tShifts.filter((s) => s.status === "open" || s.status === "request").length;

  // ---- compose the Dutch briefing ----
  const gisteren: string[] = ["📋 *Gisteren*"];
  gisteren.push(
    yShifts.length === 0
      ? "• Geen diensten gedraaid."
      : `• ${plural(yShifts.length, "dienst", "diensten")} gedraaid (${names(yShifts.map((s) => s.client))}).`,
  );
  if (problemRows.length === 0) {
    gisteren.push("• Alle uren van de afgelopen week zijn rond. 👍");
  } else {
    const byStatus = PROBLEM_STATUSES.map((st) => {
      const rows = problemRows.filter((r) => r.status === st);
      return rows.length ? `${HOURS_PROBLEM_NL[st]}: ${rows.length} (${names(rows.map((r) => r.client))})` : null;
    }).filter(Boolean);
    gisteren.push(`• ⚠ ${plural(problemRows.length, "urenregel", "urenregels")} nog niet rond — ${byStatus.join(" · ")}.`);
  }
  if (newComments.length > 0) {
    gisteren.push(`• 💬 ${plural(newComments.length, "nieuwe opmerking", "nieuwe opmerkingen")} van hotels — bijv. "${snippet(newComments[0].body)}".`);
  }

  const vandaag: string[] = ["🔭 *Vandaag*"];
  vandaag.push(
    tShifts.length === 0
      ? "• Geen diensten gepland."
      : `• ${plural(tShifts.length, "dienst", "diensten")}${openToday > 0 ? ` — ⚠ ${openToday} nog niet ingevuld` : " — allemaal ingevuld"}.`,
  );
  if (awaiting.length > 0) {
    vandaag.push(`• ${plural(awaiting.length, "urenregel", "urenregels")} wacht op jouw goedkeuring.`);
  }
  if (expiring.length > 0) {
    vandaag.push(`• ⏰ ${plural(expiring.length, "document", "documenten")} verloopt binnen 14 dagen (${names(expiring.map((e) => `${e.chef} (${e.soort})`))}).`);
  }
  if (awaiting.length === 0 && expiring.length === 0 && openToday === 0) {
    vandaag.push("• Niets urgents — rustige dag op de planning.");
  }

  const text = `Goedemorgen Maarten — je dagstart voor ${dutchDate(now)}.\n\n${gisteren.join("\n")}\n\n${vandaag.join("\n")}`;

  return {
    date: todayKey,
    text,
    hasUrgent: problemRows.length > 0 || openToday > 0 || awaiting.length > 0 || expiring.length > 0 || newComments.length > 0,
    data: {
      yesterday: { shifts: yShifts.length, unresolvedHours: problemRows.length, newClientComments: newComments.length },
      today: { shifts: tShifts.length, openShifts: openToday, hoursAwaitingApproval: awaiting.length, expiringDocs: expiring.length },
    },
  };
}
