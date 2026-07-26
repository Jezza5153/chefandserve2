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
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, placementComments, shiftHours, shifts } from "@/lib/db/schema";
import { addDaysToKey, amsterdamDayKey, amsterdamMidnightUtc } from "@/lib/roster-format";
import { expiringDocumentsForAi } from "@/lib/ai/read-model/oversight";
import { listHoursAwaitingApproval } from "@/lib/ai/read-model/hours";
import { scanRisksForAi } from "@/lib/ai/read-model/risks";

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
    risks: number;
  };
};

export async function buildDailyBriefing(now: Date): Promise<DailyBriefing> {
  const todayKey = amsterdamDayKey(now);
  const yStart = amsterdamMidnightUtc(addDaysToKey(todayKey, -1));
  const weekAgo = amsterdamMidnightUtc(addDaysToKey(todayKey, -7));
  const tStart = amsterdamMidnightUtc(todayKey);
  const tEnd = amsterdamMidnightUtc(addDaysToKey(todayKey, 1));

  const [yShifts, problemRows, newComments, tShifts, awaiting, expiring, riskScan, birthdayRows, staleRows, draftRows, benchRows] = await Promise.all([
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
    scanRisksForAi(now),
    // FLYWHEEL: the people-dimension the dashboard got — in the briefing, where a
    // one-owner relationship business actually plans its calls.
    db.execute(sql`
      select full_name as "fullName",
             to_char(date_of_birth, 'DD-MM') as "dayMonth"
      from chefs
      where deleted_at is null and status = 'active' and date_of_birth is not null
        -- Wraparound-safe week window: a plain BETWEEN on 'MM-DD' strings returns
        -- nothing for the Dec-28→Jan-04 week. When the window crosses New Year the
        -- condition flips to an OR.
        and (
          case
            when to_char(now() at time zone 'Europe/Amsterdam', 'MM-DD')
                 <= to_char((now() at time zone 'Europe/Amsterdam') + interval '7 days', 'MM-DD')
            then to_char(date_of_birth, 'MM-DD')
                 between to_char(now() at time zone 'Europe/Amsterdam', 'MM-DD')
                 and to_char((now() at time zone 'Europe/Amsterdam') + interval '7 days', 'MM-DD')
            else to_char(date_of_birth, 'MM-DD') >= to_char(now() at time zone 'Europe/Amsterdam', 'MM-DD')
                 or to_char(date_of_birth, 'MM-DD') <= to_char((now() at time zone 'Europe/Amsterdam') + interval '7 days', 'MM-DD')
          end
        )
      order by to_char(date_of_birth, 'MM-DD') limit 5
    `),
    db.execute(sql`
      select c.full_name as "fullName",
             extract(day from now() - coalesce(max(cl.created_at), c.joined_at))::int as "daysSilent"
      from chefs c
      left join contact_logs cl on cl.target_type = 'chef' and cl.target_id = c.id
      where c.deleted_at is null and c.status = 'active'
      group by c.id, c.full_name, c.joined_at
      having coalesce(max(cl.created_at), c.joined_at) < now() - interval '21 days'
      order by coalesce(max(cl.created_at), c.joined_at) asc limit 1
    `),
    // Preplan concepts awaiting review — drafts are invisible on the planbord until
    // published, so without this line they can be silently forgotten.
    db.execute(sql`
      select count(*)::int as n from placements p
      join shifts s on s.id = p.shift_id
      where p.status = 'draft' and s.starts_at >= ${tStart}
    `),
    // Chefs NOT placed today ("no availability row = unknown", so phrased as "niet ingepland").
    db.execute(sql`
      select count(*)::int as n from chefs c
      where c.deleted_at is null and c.status = 'active'
        and not exists (
          select 1 from placements p join shifts s on s.id = p.shift_id
          where p.chef_id = c.id and p.status in ('accepted','confirmed')
            and s.starts_at >= ${tStart} and s.starts_at < ${tEnd}
        )
    `),
  ]);

  const openToday = tShifts.filter((s) => s.status === "open" || s.status === "request").length;
  const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? []));
  const birthdays = rowsOf(birthdayRows) as { fullName: string; dayMonth: string }[];
  const stale = rowsOf(staleRows) as { fullName: string; daysSilent: number }[];
  const bench = (rowsOf(benchRows) as { n: number }[])[0]?.n ?? 0;
  const drafts = (rowsOf(draftRows) as { n: number }[])[0]?.n ?? 0;

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
  if (drafts > 0) {
    vandaag.push(`• 🤖 AI heeft ${plural(drafts, "concept-plek", "concept-plekken")} vooringevuld — review & publiceer op het planbord.`);
  }

  const risico: string[] = [];
  if (riskScan.risks.length > 0) {
    risico.push("⚠️ *Risico's (vooruit)*");
    for (const r of riskScan.risks.slice(0, 3)) risico.push(`• ${r.ernst === "hoog" ? "🔴" : "🟠"} ${r.melding}`);
  }

  // ---- mensen ----
  const mensen: string[] = [];
  if (birthdays.length > 0 || stale.length > 0 || bench > 0) {
    mensen.push("👥 *Je mensen*");
    for (const b of birthdays) mensen.push(`• 🎂 ${b.fullName} is binnenkort jarig (${b.dayMonth}) — stuur een berichtje.`);
    if (stale.length > 0) mensen.push(`• 📞 ${stale[0]!.fullName} al ${stale[0]!.daysSilent} dagen niet gesproken — bel of app vandaag even.`);
    if (bench > 0) mensen.push(`• ${plural(bench, "chef", "chefs")} vandaag niet ingepland — jouw bellijst bij uitval.`);
  }

  const sections = [gisteren.join("\n"), vandaag.join("\n")];
  if (mensen.length > 0) sections.push(mensen.join("\n"));
  if (risico.length > 0) sections.push(risico.join("\n"));
  const text = `Goedemorgen Maarten — je dagstart voor ${dutchDate(now)}.\n\n${sections.join("\n\n")}`;

  const highRisk = riskScan.risks.some((r) => r.ernst === "hoog");
  return {
    date: todayKey,
    text,
    hasUrgent: problemRows.length > 0 || openToday > 0 || awaiting.length > 0 || expiring.length > 0 || newComments.length > 0 || highRisk,
    data: {
      yesterday: { shifts: yShifts.length, unresolvedHours: problemRows.length, newClientComments: newComments.length },
      today: { shifts: tShifts.length, openShifts: openToday, hoursAwaitingApproval: awaiting.length, expiringDocs: expiring.length },
      risks: riskScan.count,
    },
  };
}
