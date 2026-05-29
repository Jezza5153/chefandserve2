/**
 * Roster cockpit intelligence — PR-1. Pure + deterministic (no DB, no React, no
 * AI). The page renders ONLY from this engine's output, and the future AI reads
 * the same object via `rosterAiSummary` — so the screen and the AI never disagree.
 *
 * Builds the Day / Week / Month view-models + the operator KPIs/signals from
 * already-loaded shift+placement rows. Reuses `roster-format` (tz/grid + health)
 * and `dashboard-intel` (attention ranking).
 *
 * ───────── ACTIVE-FILL RULE (the one logic risk, locked) ─────────
 * Placement statuses: proposed · accepted · rejected · confirmed · cancelled ·
 * no_show · completed. For FUTURE/TODAY staffing fill we count only LIVE
 * placements and never let `completed` inflate a future shift:
 *   • gevuld (green, "klaar")      = confirmed ≥ headcount        (strict — only a
 *                                    CONFIRMED chef locks a slot)
 *   • activeCovered                = confirmed + accepted          (a slot a chef
 *                                    said yes to is "covered, pending confirmation")
 *   • openSlots                    = max(0, headcount − activeCovered)
 *   • teBevestigen                 = activeCovered ≥ headcount AND confirmed <
 *                                    headcount  (covered but NOT locked → never
 *                                    reads as "done"; surfaced as wacht-op-bevestiging)
 * `completed` is a PAST/historical signal only; this engine operates on the
 * current/near-future roster and treats ended/completed shifts as `done`.
 */

import {
  amsterdamDayKey,
  getFillState,
  getShiftHealth,
  getShiftWarnings,
  type FillState,
  type RosterSettings,
  type ShiftHealth,
  type ShiftIntelInput,
} from "@/lib/roster-format";
import {
  rankAttentionItems,
  type AttentionItem,
} from "@/lib/domain/dashboard-intel";

export type RosterView = "day" | "week" | "month";

/** Time-of-day "role" the roster shows on a block (NOT vakniveau). */
export type Dagdeel = "ontbijt" | "lunch" | "diner" | "late";
const DAGDEEL_LABEL: Record<Dagdeel, string> = {
  ontbijt: "Ontbijt",
  lunch: "Lunch",
  diner: "Diner",
  late: "Late night",
};

/** The loaded shift row (matches the page's grouped query + a few extras). */
export type RosterShiftRow = {
  id: string;
  startsAt: Date | string;
  endsAt: Date | string;
  /** vakniveau (skill needed) — used for supply↔demand + a skill chip. */
  roleNeeded: string;
  headcount: number;
  status: string;
  location?: string | null;
  city?: string | null;
  clientId: string;
  companyName: string | null;
  confirmedCount: number;
  acceptedCount: number;
  proposedCount: number;
  /** Earliest still-open proposal (for the no-response timer). */
  earliestProposedAt?: Date | string | null;
  /** Financial-lock signals (joined from shift_hours + payroll_batch_lines). */
  hoursApproved?: boolean;
  payrollLocked?: boolean;
};

/** Date-level available chef (no placement that day) for the supply panel. */
export type AvailableChefRow = {
  id: string;
  fullName: string;
  city?: string | null;
  /** Best-effort skill buckets (from segments/specialties) → dagdeel-ish. */
  skills?: string[] | null;
  roleNeeded?: string | null; // vakniveau the chef fits, best-effort
};

export type RosterInput = {
  view: RosterView;
  /** Focus day (`YYYY-MM-DD`, Amsterdam). */
  dateKey: string;
  rows: RosterShiftRow[];
  /** Date-level available + NOT-placed chefs (Day view supply panel). */
  availableChefs?: AvailableChefRow[];
  settings?: Partial<RosterSettings>;
  now?: Date;
};

/* ───────── helpers ───────── */

function toDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

/** Amsterdam-local hour (0–23) of an instant. */
function amsHour(d: Date | string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Amsterdam",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(toDate(d)),
  );
}

/** Time-of-day bucket from the Amsterdam start hour. */
export function dagdeelOf(startsAt: Date | string): Dagdeel {
  const h = amsHour(startsAt);
  if (h < 11) return "ontbijt";
  if (h < 16) return "lunch";
  if (h < 21) return "diner";
  return "late";
}
export function dagdeelLabel(d: Dagdeel): string {
  return DAGDEEL_LABEL[d];
}

/**
 * Board "dienst" name from the Amsterdam start hour — the cockpit's daypart-kok
 * vocabulary: <10 "Ontbijt kok" · <16 "Allround kok" · else "Avond kok".
 * (The real vakniveau stays available on the row for the tooltip / detail page.)
 */
export function dienstLabel(startsAt: Date | string): string {
  const h = amsHour(startsAt);
  if (h < 10) return "Ontbijt kok";
  if (h < 16) return "Allround kok";
  return "Avond kok";
}

function intelInput(row: RosterShiftRow, settings?: Partial<RosterSettings>, now?: Date): ShiftIntelInput {
  return {
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status,
    headcount: row.headcount,
    confirmedCount: row.confirmedCount,
    acceptedCount: row.acceptedCount,
    proposedCount: row.proposedCount,
    location: row.location,
    city: row.city,
    hasClient: Boolean(row.companyName),
    settings,
    now,
  };
}

const ACTIVE = (h: ShiftHealth) => h !== "done" && h !== "cancelled";

export type ShiftFill = {
  headcount: number;
  confirmed: number;
  accepted: number;
  proposed: number;
  /** confirmed + accepted (a slot a chef said yes to). */
  activeCovered: number;
  /** slots not yet covered (active rule). */
  openSlots: number;
  /** covered by accepted+confirmed but not all confirmed → "wacht op bevestiging". */
  teBevestigen: boolean;
  /** confirmed ≥ headcount. */
  gevuld: boolean;
  health: ShiftHealth;
  fillState: FillState;
};

export function shiftFill(row: RosterShiftRow, settings?: Partial<RosterSettings>, now?: Date): ShiftFill {
  const input = intelInput(row, settings, now);
  const confirmed = row.confirmedCount;
  const accepted = row.acceptedCount;
  const proposed = row.proposedCount;
  const activeCovered = confirmed + accepted;
  const openSlots = Math.max(0, row.headcount - activeCovered);
  return {
    headcount: row.headcount,
    confirmed,
    accepted,
    proposed,
    activeCovered,
    openSlots,
    teBevestigen: activeCovered >= row.headcount && confirmed < row.headcount,
    gevuld: confirmed >= row.headcount,
    health: getShiftHealth(input),
    fillState: getFillState(input),
  };
}

/** Hours until a shift starts (negative = already started). */
function hoursUntil(startsAt: Date | string, now: Date): number {
  return (toDate(startsAt).getTime() - now.getTime()) / 3_600_000;
}

/* ───────── KPIs ───────── */

export type RosterKpi = {
  key: string;
  label: string;
  value: number;
  /** sublines, e.g. role breakdown "4 ontbijt · 2 diner". */
  detail?: string;
  /** optional share-of-total badge (e.g. 75 → "75%"). */
  pct?: number;
  tone: "ok" | "amber" | "red";
  /** the ?filter= this KPI links to (clickable filter — read-only narrowing). */
  filter?: string;
};

/**
 * Day-board fill tone (confirmed-driven, the operator's colour language):
 *   vol (green)   = confirmed ≥ headcount
 *   leeg (red)    = confirmed 0 (nobody locked in — the real risk)
 *   deels (amber) = partially confirmed
 * Note: this is intentionally SOFTER than `getShiftHealth` — a partially-filled
 * shift today reads amber "onderbezet", not red, so the board isn't a wall of red.
 */
export type DayTone = "vol" | "deels" | "leeg";
export function dayToneOf(confirmed: number, headcount: number): DayTone {
  if (confirmed >= headcount) return "vol";
  if (confirmed <= 0) return "leeg";
  return "deels";
}

/** Count open slots by dagdeel + vakniveau (role pressure). */
function openByRole(active: { row: RosterShiftRow; fill: ShiftFill }[]) {
  const byDagdeel = new Map<Dagdeel, number>();
  const byVak = new Map<string, number>();
  for (const { row, fill } of active) {
    if (fill.openSlots <= 0) continue;
    const dd = dagdeelOf(row.startsAt);
    byDagdeel.set(dd, (byDagdeel.get(dd) ?? 0) + fill.openSlots);
    byVak.set(row.roleNeeded, (byVak.get(row.roleNeeded) ?? 0) + fill.openSlots);
  }
  return { byDagdeel, byVak };
}

function dagdeelBreakdownLabel(byDagdeel: Map<Dagdeel, number>): string {
  return (["ontbijt", "lunch", "diner", "late"] as Dagdeel[])
    .filter((d) => (byDagdeel.get(d) ?? 0) > 0)
    .map((d) => `${byDagdeel.get(d)} ${d}`)
    .join(" · ");
}

/* ───────── attention (priority-tiered, self-explaining) ───────── */

function dayLabel(startsAt: Date | string): string {
  return new Date(`${amsterdamDayKey(startsAt)}T12:00:00Z`).toLocaleDateString("nl-NL", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Human "start over Xu" / "gestart" timing string. */
function timingLabel(startsAt: Date | string, now: Date): string {
  const h = hoursUntil(startsAt, now);
  if (h < 0) return "gestart";
  if (h < 1) return `start over ${Math.round(h * 60)} min`;
  if (h < 48) return `start over ${Math.round(h)}u`;
  return dayLabel(startsAt);
}

/**
 * Build the ranked attention list. Every item self-explains (reason + timing),
 * never a bare "Aandacht". Reuses dashboard-intel kinds → rankAttentionItems
 * orders them kritiek(critical) → open → onderbezet → wacht-bevestiging →
 * wacht-reactie → data-quality → overlap(system).
 */
export function buildAttention(
  rows: RosterShiftRow[],
  settings?: Partial<RosterSettings>,
  now: Date = new Date(),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const row of rows) {
    const fill = shiftFill(row, settings, now);
    if (!ACTIVE(fill.health)) continue;
    const who = row.companyName ?? "Onbekende klant";
    const dd = dagdeelLabel(dagdeelOf(row.startsAt));
    const when = timingLabel(row.startsAt, now);
    const href = `/admin/business/shifts/${row.id}`;

    if (fill.health === "critical") {
      items.push({
        kind: "critical_shift",
        tone: "red",
        icon: "alert-triangle",
        title: `${who} · ${dd} kritiek`,
        detail: `${fill.openSlots} open · ${when}`,
        href,
        cta: "Open dienst",
      });
    } else if (fill.confirmed === 0 && fill.openSlots > 0) {
      items.push({
        kind: "open_shift",
        tone: hoursUntil(row.startsAt, now) <= 48 ? "red" : "amber",
        icon: "alert-triangle",
        title: `${who} · ${dd} open`,
        detail: `${fill.openSlots} open · ${when}`,
        href,
        cta: "Open dienst",
      });
    } else if (fill.openSlots > 0) {
      items.push({
        kind: "underfilled_shift",
        tone: "amber",
        icon: "info",
        title: `${who} · ${dd} onderbezet`,
        detail: `${fill.confirmed}/${fill.headcount} bevestigd · ${fill.openSlots} open · ${when}`,
        href,
        cta: "Open dienst",
      });
    } else if (fill.teBevestigen) {
      items.push({
        kind: "accepted_unconfirmed",
        tone: "blue",
        icon: "clock",
        title: `${who} · ${dd} te bevestigen`,
        detail: `${fill.accepted} geaccepteerd, nog niet bevestigd · ${when}`,
        href,
        cta: "Bevestig",
      });
    }

    // Waiting on a chef reply (independent of fill) — only if still open-ish.
    if (fill.proposed > 0 && fill.openSlots > 0 && fill.health !== "critical") {
      const since = row.earliestProposedAt ? hoursUntil(row.earliestProposedAt, now) : null;
      items.push({
        kind: "proposed_no_response",
        tone: "blue",
        icon: "clock",
        title: `${who} · ${dd} wacht op reactie`,
        detail:
          since != null && since < 0
            ? `${fill.proposed} voorgesteld · geen reactie ${Math.round(-since)}u`
            : `${fill.proposed} chef(s) voorgesteld`,
        href,
        cta: "Bekijk",
      });
    }

    // Data-quality flags that block planning.
    const warnings = getShiftWarnings(intelInput(row, settings, now));
    if (warnings.length > 0) {
      items.push({
        kind: "missing_data",
        tone: "grey",
        icon: "info",
        title: `${who} · gegevens missen`,
        detail: `${warnings.join(" · ")} · ${when}`,
        href,
        cta: "Aanvullen",
      });
    }
  }
  return rankAttentionItems(items);
}

/* ───────── chef overlaps (needs per-chef placement times) ───────── */

export type OverlapInput = {
  chefId: string;
  chefName: string;
  shiftId: string;
  startsAt: Date | string;
  endsAt: Date | string;
};
export type ChefOverlap = {
  chefId: string;
  chefName: string;
  from: string; // HH:MM
  to: string;
};

function hhmm(d: Date | string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(toDate(d));
}

/** Detect chefs double-booked on overlapping placements (same day window). */
export function detectOverlaps(placements: OverlapInput[]): ChefOverlap[] {
  const byChef = new Map<string, OverlapInput[]>();
  for (const p of placements) {
    const arr = byChef.get(p.chefId);
    if (arr) arr.push(p);
    else byChef.set(p.chefId, [p]);
  }
  const out: ChefOverlap[] = [];
  for (const [chefId, ps] of byChef) {
    const sorted = [...ps].sort((a, b) => toDate(a.startsAt).getTime() - toDate(b.startsAt).getTime());
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = toDate(sorted[i - 1].endsAt).getTime();
      const curStart = toDate(sorted[i].startsAt).getTime();
      if (curStart < prevEnd) {
        out.push({
          chefId,
          chefName: sorted[i].chefName,
          from: hhmm(sorted[i].startsAt),
          to: hhmm(sorted[i - 1].endsAt),
        });
      }
    }
  }
  return out;
}

/* ───────── view-model ───────── */

export type DayHotelShift = { row: RosterShiftRow; fill: ShiftFill; dagdeel: Dagdeel };
export type DayHotel = { clientId: string; companyName: string; shifts: DayHotelShift[] };

export type HotelDayCell = {
  dayKey: string;
  confirmed: number;
  headcount: number;
  openSlots: number;
  health: ShiftHealth; // worst of the day
};
export type WeekHotelRow = {
  clientId: string;
  companyName: string;
  cells: HotelDayCell[];
  totalConfirmed: number;
  totalHeadcount: number;
  hasAttention: boolean;
};
export type MonthDayCell = {
  dayKey: string;
  inMonth: boolean;
  shiftCount: number;
  bezettingPct: number | null; // null = no shifts
  bucket: "none" | "low" | "mid" | "high" | "peak";
  kritiek: boolean;
};

export type RosterViewModel = {
  view: RosterView;
  dateKey: string;
  kpis: RosterKpi[];
  attention: AttentionItem[];
  /** Partially-covered active shifts (0 < confirmed < headcount). */
  onderbezet: number;
  /** Day timeline grouped per hotel (only for view=day). */
  dayHotels?: DayHotel[];
  /** Week grid (only for view=week). */
  weekHotels?: WeekHotelRow[];
  /** Month heatmap (only for view=month). */
  monthDays?: MonthDayCell[];
  monthTopHotels?: { companyName: string; shiftCount: number; openSlots: number }[];
  monthRoleShortage?: { dagdeel: Dagdeel; open: number }[];
  hardestRole?: { dagdeel: Dagdeel; open: number } | null;
  topClientPressure?: { companyName: string; shiftCount: number; openSlots: number } | null;
  hotelsMetAandacht?: { count: number; names: string[] };
  openBinnen48u: number;
  /** Available chefs not scheduled (Day) — count + skill split. */
  beschikbaarNietIngepland?: { count: number; bySkill: Record<string, number> };
};

const bucketFor = (pct: number | null): MonthDayCell["bucket"] => {
  if (pct == null) return "none";
  if (pct < 70) return "low";
  if (pct < 80) return "mid";
  if (pct < 95) return "high";
  return "peak";
};

/** The one entry point: build the full view-model for the page (and the AI). */
export function buildRosterView(input: RosterInput): RosterViewModel {
  const now = input.now ?? new Date();
  const S = input.settings;
  const enriched = input.rows.map((row) => ({ row, fill: shiftFill(row, S, now) }));
  const active = enriched.filter((e) => ACTIVE(e.fill.health));

  const totalHeadcount = active.reduce((s, e) => s + e.fill.headcount, 0);
  const totalConfirmed = active.reduce((s, e) => s + Math.min(e.fill.confirmed, e.fill.headcount), 0);
  const openPlekken = active.reduce((s, e) => s + e.fill.openSlots, 0);
  const kritiek = active.filter((e) => e.fill.health === "critical").length;
  const onderbezet = active.filter((e) => e.fill.openSlots > 0 && e.fill.confirmed > 0).length;
  const bezettingPct = totalHeadcount > 0 ? Math.round((totalConfirmed / totalHeadcount) * 100) : null;
  const openBinnen48u = active.filter((e) => e.fill.openSlots > 0 && hoursUntil(e.row.startsAt, now) <= 48 && hoursUntil(e.row.startsAt, now) >= -1).length;
  const { byDagdeel } = openByRole(active);
  const roleDetail = dagdeelBreakdownLabel(byDagdeel);

  const attention = buildAttention(input.rows, S, now);

  // hotels met aandacht (venue-first)
  const attHotels = new Map<string, string>();
  for (const e of active) {
    if (e.fill.health === "critical" || e.fill.openSlots > 0) {
      attHotels.set(e.row.clientId, e.row.companyName ?? "Onbekende klant");
    }
  }
  const hotelsMetAandacht = { count: attHotels.size, names: [...attHotels.values()].slice(0, 3) };

  const kpis: RosterKpi[] = [];
  if (input.view === "day") {
    // Partition active shifts by confirmed-fill (vol + open + kritiek = totaal).
    const totaal = active.length;
    const vol = active.filter((e) => dayToneOf(e.fill.confirmed, e.fill.headcount) === "vol").length;
    const leeg = active.filter((e) => dayToneOf(e.fill.confirmed, e.fill.headcount) === "leeg").length;
    const deels = totaal - vol - leeg;
    const chefsIngepland = active.reduce((s, e) => s + Math.min(e.fill.confirmed, e.fill.headcount), 0);
    const beschikbaar = input.availableChefs?.length ?? 0;
    const pct = (n: number) => (totaal > 0 ? Math.round((n / totaal) * 100) : 0);
    kpis.push({ key: "totaal", label: "Totaal diensten", value: totaal, tone: "ok" });
    kpis.push({ key: "ingevuld", label: "Ingevuld", value: vol, pct: pct(vol), tone: "ok", filter: "ingevuld" });
    kpis.push({ key: "open", label: "Open", value: deels, pct: pct(deels), tone: deels > 0 ? "amber" : "ok", filter: "open" });
    kpis.push({ key: "kritiek", label: "Kritiek", value: leeg, pct: pct(leeg), tone: leeg > 0 ? "red" : "ok", filter: "kritiek" });
    kpis.push({ key: "chefs", label: "Chefs ingepland", value: chefsIngepland, tone: "ok" });
    kpis.push({ key: "beschikbaar", label: "Beschikbare chefs", value: beschikbaar, tone: "ok", filter: "beschikbaar" });
  } else if (input.view === "week") {
    kpis.push({ key: "diensten", label: "Diensten deze week", value: active.length, tone: "ok" });
    kpis.push({ key: "open", label: "Open plekken", value: openPlekken, detail: roleDetail || undefined, tone: openPlekken > 0 ? "amber" : "ok", filter: "open" });
    kpis.push({ key: "hotels", label: "Hotels met aandacht", value: hotelsMetAandacht.count, detail: hotelsMetAandacht.names.join(" · ") || undefined, tone: hotelsMetAandacht.count > 0 ? "amber" : "ok", filter: "kritiek" });
    kpis.push({ key: "kritiek", label: "Kritiek", value: kritiek, tone: kritiek > 0 ? "red" : "ok", filter: "kritiek" });
  }

  const vm: RosterViewModel = {
    view: input.view,
    dateKey: input.dateKey,
    kpis,
    attention,
    onderbezet,
    openBinnen48u,
    hotelsMetAandacht,
  };

  if (input.view === "day") {
    const byHotel = new Map<string, DayHotel>();
    for (const e of enriched) {
      let h = byHotel.get(e.row.clientId);
      if (!h) {
        h = { clientId: e.row.clientId, companyName: e.row.companyName ?? "Onbekende klant", shifts: [] };
        byHotel.set(e.row.clientId, h);
      }
      h.shifts.push({ row: e.row, fill: e.fill, dagdeel: dagdeelOf(e.row.startsAt) });
    }
    vm.dayHotels = [...byHotel.values()];
    if (input.availableChefs) {
      const bySkill: Record<string, number> = {};
      for (const c of input.availableChefs) {
        for (const s of c.skills ?? ["onbekend"]) bySkill[s] = (bySkill[s] ?? 0) + 1;
      }
      vm.beschikbaarNietIngepland = { count: input.availableChefs.length, bySkill };
    }
  }

  if (input.view === "week") {
    const byHotel = new Map<string, { companyName: string; perDay: Map<string, { confirmed: number; headcount: number; open: number; health: ShiftHealth }> ; attention: boolean }>();
    for (const e of enriched) {
      const key = e.row.clientId;
      let h = byHotel.get(key);
      if (!h) {
        h = { companyName: e.row.companyName ?? "Onbekende klant", perDay: new Map(), attention: false };
        byHotel.set(key, h);
      }
      const dk = amsterdamDayKey(e.row.startsAt);
      const cell = h.perDay.get(dk) ?? { confirmed: 0, headcount: 0, open: 0, health: "healthy" as ShiftHealth };
      cell.confirmed += Math.min(e.fill.confirmed, e.fill.headcount);
      cell.headcount += e.fill.headcount;
      cell.open += e.fill.openSlots;
      // worst health wins
      const rank: ShiftHealth[] = ["critical", "empty", "underfilled", "attention", "healthy", "done", "cancelled"];
      if (rank.indexOf(e.fill.health) < rank.indexOf(cell.health)) cell.health = e.fill.health;
      h.perDay.set(dk, cell);
      if (ACTIVE(e.fill.health) && (e.fill.health === "critical" || e.fill.openSlots > 0)) h.attention = true;
    }
    vm.weekHotels = [...byHotel.entries()].map(([clientId, h]) => {
      const cells: HotelDayCell[] = [...h.perDay.entries()].map(([dayKey, c]) => ({
        dayKey,
        confirmed: c.confirmed,
        headcount: c.headcount,
        openSlots: c.open,
        health: c.health,
      }));
      return {
        clientId,
        companyName: h.companyName,
        cells,
        totalConfirmed: cells.reduce((s, c) => s + c.confirmed, 0),
        totalHeadcount: cells.reduce((s, c) => s + c.headcount, 0),
        hasAttention: h.attention,
      };
    });
  }

  if (input.view === "month") {
    // per-day aggregates
    const byDay = new Map<string, { confirmed: number; headcount: number; count: number; kritiek: boolean }>();
    for (const e of enriched) {
      const dk = amsterdamDayKey(e.row.startsAt);
      const d = byDay.get(dk) ?? { confirmed: 0, headcount: 0, count: 0, kritiek: false };
      d.confirmed += Math.min(e.fill.confirmed, e.fill.headcount);
      d.headcount += e.fill.headcount;
      d.count += 1;
      if (e.fill.health === "critical") d.kritiek = true;
      byDay.set(dk, d);
    }
    vm.monthDays = []; // filled by the page against the month grid via monthCellFor()
    // top hotels + role shortage + pressure
    const byHotel = new Map<string, { companyName: string; shiftCount: number; openSlots: number }>();
    for (const e of enriched) {
      const h = byHotel.get(e.row.clientId) ?? { companyName: e.row.companyName ?? "Onbekende klant", shiftCount: 0, openSlots: 0 };
      h.shiftCount += 1;
      h.openSlots += e.fill.openSlots;
      byHotel.set(e.row.clientId, h);
    }
    const hotels = [...byHotel.values()].sort((a, b) => b.shiftCount - a.shiftCount);
    vm.monthTopHotels = hotels.slice(0, 5);
    vm.topClientPressure = hotels[0] ?? null;
    const roleShort = (["ontbijt", "lunch", "diner", "late"] as Dagdeel[])
      .map((dd) => ({ dagdeel: dd, open: byDagdeel.get(dd) ?? 0 }))
      .filter((r) => r.open > 0)
      .sort((a, b) => b.open - a.open);
    vm.monthRoleShortage = roleShort;
    vm.hardestRole = roleShort[0] ?? null;
    // month KPIs
    const kritiekeDagen = [...byDay.values()].filter((d) => d.kritiek).length;
    vm.kpis = [
      { key: "bezetting", label: "Bezettingsgraad", value: bezettingPct ?? 0, tone: bezettingPct != null && bezettingPct < 80 ? "amber" : "ok" },
      { key: "open", label: "Open plekken", value: openPlekken, detail: roleDetail || undefined, tone: openPlekken > 0 ? "amber" : "ok", filter: "open" },
      { key: "kritieke-dagen", label: "Kritieke dagen", value: kritiekeDagen, tone: kritiekeDagen > 0 ? "red" : "ok", filter: "kritiek" },
      { key: "moeilijkste-rol", label: "Moeilijkste rol", value: vm.hardestRole?.open ?? 0, detail: vm.hardestRole ? dagdeelLabel(vm.hardestRole.dagdeel) : undefined, tone: vm.hardestRole && vm.hardestRole.open > 0 ? "amber" : "ok", filter: vm.hardestRole ? `role:${vm.hardestRole.dagdeel}` : undefined },
    ];
    // attach the per-day map so the page can render the grid
    (vm as RosterViewModel & { _monthByDay?: Map<string, { confirmed: number; headcount: number; count: number; kritiek: boolean }> })._monthByDay = byDay;
  }

  return vm;
}

/** Resolve a single month-grid day cell from the engine's per-day map. */
export function monthCellFor(
  vm: RosterViewModel,
  dayKey: string,
  inMonth: boolean,
): MonthDayCell {
  const byDay = (vm as RosterViewModel & { _monthByDay?: Map<string, { confirmed: number; headcount: number; count: number; kritiek: boolean }> })._monthByDay;
  const d = byDay?.get(dayKey);
  const pct = d && d.headcount > 0 ? Math.round((d.confirmed / d.headcount) * 100) : d ? 0 : null;
  return {
    dayKey,
    inMonth,
    shiftCount: d?.count ?? 0,
    bezettingPct: pct,
    bucket: bucketFor(pct),
    kritiek: d?.kritiek ?? false,
  };
}

/* ───────── AI summary (the same object the screen renders from) ───────── */

export function rosterAiSummary(vm: RosterViewModel): {
  text: string;
  facts: Record<string, unknown>;
} {
  const open = vm.kpis.find((k) => k.key === "open")?.value ?? 0;
  const kritiek = vm.kpis.find((k) => k.key === "kritiek")?.value ?? vm.kpis.find((k) => k.key === "kritieke-dagen")?.value ?? 0;
  const parts: string[] = [];
  parts.push(`${open} open ${open === 1 ? "plek" : "plekken"}.`);
  if (vm.hardestRole) parts.push(`${dagdeelLabel(vm.hardestRole.dagdeel)} heeft de meeste druk (${vm.hardestRole.open} open).`);
  if (vm.topClientPressure && vm.topClientPressure.openSlots > 0) parts.push(`${vm.topClientPressure.companyName} veroorzaakt de meeste druk.`);
  if (vm.hotelsMetAandacht && vm.hotelsMetAandacht.count > 0) parts.push(`${vm.hotelsMetAandacht.count} hotel(s) vragen aandacht.`);
  if (vm.openBinnen48u > 0) parts.push(`${vm.openBinnen48u} open binnen 48 uur.`);
  if (vm.beschikbaarNietIngepland && vm.beschikbaarNietIngepland.count > 0) parts.push(`${vm.beschikbaarNietIngepland.count} passende chefs nog niet ingepland.`);
  if (Number(kritiek) > 0) parts.unshift(`${kritiek} kritiek.`);
  return {
    text: parts.join(" "),
    facts: {
      view: vm.view,
      dateKey: vm.dateKey,
      kpis: vm.kpis.map((k) => ({ key: k.key, value: k.value, detail: k.detail })),
      openBinnen48u: vm.openBinnen48u,
      hotelsMetAandacht: vm.hotelsMetAandacht,
      hardestRole: vm.hardestRole,
      attentionCount: vm.attention.length,
    },
  };
}
