/**
 * Roster intelligence — PR-1. Pure, deterministic, testable. No DB, no React, no AI.
 *
 * Turns a shift + its placement counts into the control-center's visual language:
 * which day it falls on (Amsterdam-local), how healthy it is, what the next action
 * is, and what data is missing. The roster UI and the "Aandacht nodig" strip render
 * straight off these helpers.
 *
 * Amsterdam-local bucketing matters: a shift at 23:30 UTC on the 1st is the 2nd in
 * Amsterdam (CEST). We bucket + display by the Amsterdam calendar day, never UTC.
 */

const AMS = "Europe/Amsterdam";
const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

/* ----- Amsterdam-local day keys (DST-safe) -------------------------------- */

/** `YYYY-MM-DD` for the Amsterdam calendar day containing this instant. */
export function amsterdamDayKey(d: Date | string): string {
  // en-CA formats as ISO-like YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: AMS,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(toDate(d));
}

/** Offset (local − UTC, ms) of the Amsterdam zone at a given instant. */
function amsOffsetMs(instant: Date): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: AMS,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const m: Record<string, string> = {};
  for (const part of p) m[part.type] = part.value;
  const asUtc = Date.UTC(
    +m.year,
    +m.month - 1,
    +m.day,
    +m.hour,
    +m.minute,
    +m.second,
  );
  return asUtc - instant.getTime();
}

/** The UTC instant of 00:00 Amsterdam wall-clock on `dayKey` (`YYYY-MM-DD`). */
export function amsterdamMidnightUtc(dayKey: string): Date {
  const [y, mo, d] = dayKey.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, 0, 0, 0);
  const offset = amsOffsetMs(new Date(guess));
  return new Date(guess - offset);
}

/** Add `n` calendar days to a `YYYY-MM-DD` key (DST-safe — pure date math). */
export function addDaysToKey(dayKey: string, n: number): string {
  const [y, mo, d] = dayKey.split("-").map(Number);
  // noon UTC avoids any DST/rounding drift across the +n shift
  const t = Date.UTC(y, mo - 1, d, 12) + n * DAY_MS;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** 0=Sun … 6=Sat for a calendar day key (weekday is offset-independent). */
function weekdayOfKey(dayKey: string): number {
  return new Date(`${dayKey}T12:00:00Z`).getUTCDay();
}

/* ----- week + month ranges ------------------------------------------------ */

export type WeekRange = {
  /** Monday of the week, `YYYY-MM-DD`. */
  startKey: string;
  /** Sunday of the week, `YYYY-MM-DD`. */
  endKey: string;
  /** 7 day keys, Monday → Sunday. */
  days: string[];
  /** UTC instant of Monday 00:00 Amsterdam (inclusive query bound). */
  startUtc: Date;
  /** UTC instant of NEXT Monday 00:00 Amsterdam (exclusive query bound). */
  endUtc: Date;
};

/** The Monday-started Amsterdam week containing `input` (default: now). */
export function getAmsterdamWeekRange(input?: string | Date): WeekRange {
  const baseKey =
    typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)
      ? input
      : amsterdamDayKey(input ? toDate(input) : new Date());
  const mondayOffset = (weekdayOfKey(baseKey) + 6) % 7; // Sun(0)→6, Mon(1)→0 …
  const startKey = addDaysToKey(baseKey, -mondayOffset);
  const days = Array.from({ length: 7 }, (_, i) => addDaysToKey(startKey, i));
  return {
    startKey,
    endKey: days[6],
    days,
    startUtc: amsterdamMidnightUtc(startKey),
    endUtc: amsterdamMidnightUtc(addDaysToKey(startKey, 7)),
  };
}

export type MonthGrid = {
  /** `YYYY-MM` of the focused month. */
  monthKey: string;
  /** 42 day keys (6 weeks × 7), Monday-started, spilling into adjacent months. */
  gridDays: string[];
  /** Which grid days belong to the focused month. */
  inMonth: boolean[];
  startUtc: Date;
  endUtc: Date;
};

/** 6×7 Monday-started month grid containing `input` (default: now). */
export function getAmsterdamMonthGrid(input?: string | Date): MonthGrid {
  const baseKey =
    typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)
      ? input
      : amsterdamDayKey(input ? toDate(input) : new Date());
  const [y, mo] = baseKey.split("-").map(Number);
  const monthKey = `${y}-${String(mo).padStart(2, "0")}`;
  const firstKey = `${monthKey}-01`;
  const gridStart = addDaysToKey(firstKey, -((weekdayOfKey(firstKey) + 6) % 7));
  const gridDays = Array.from({ length: 42 }, (_, i) => addDaysToKey(gridStart, i));
  const inMonth = gridDays.map((k) => k.startsWith(`${monthKey}-`));
  return {
    monthKey,
    gridDays,
    inMonth,
    startUtc: amsterdamMidnightUtc(gridStart),
    endUtc: amsterdamMidnightUtc(addDaysToKey(gridDays[41], 1)),
  };
}

/** `YYYY-MM` ± n months, returning the first-day key for nav links. */
export function shiftMonthKey(monthKey: string, n: number): string {
  const [y, mo] = monthKey.split("-").map(Number);
  const total = y * 12 + (mo - 1) + n;
  const ny = Math.floor(total / 12);
  const nmo = (total % 12) + 1;
  return `${ny}-${String(nmo).padStart(2, "0")}-01`;
}

/** Bucket rows by their Amsterdam day key. */
export function bucketShiftsByAmsterdamDay<T extends { startsAt: Date | string }>(
  rows: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const key = amsterdamDayKey(r.startsAt);
    const arr = map.get(key);
    if (arr) arr.push(r);
    else map.set(key, [r]);
  }
  return map;
}

/* ----- the intelligence: health · next action · warnings · fill ----------- */

export type ShiftHealth =
  | "cancelled"
  | "done"
  | "critical"
  | "empty"
  | "underfilled"
  | "attention"
  | "healthy";

export type FillState =
  | "cancelled"
  | "done"
  | "unknown"
  | "full"
  | "partial"
  | "empty"
  | "emptySoon";

/**
 * Tunable thresholds + labels. These are DEFAULTS — every helper accepts an
 * optional `settings` override so the planned Instellingen page can let each
 * employee fine-tune the cockpit (critical lead-time, wording) without any code
 * change. PR-1 ships the defaults; the settings page just feeds overrides in.
 */
export type RosterSettings = {
  /** A shift this many hours away (or closer) and still under headcount = critical. */
  criticalHours: number;
  /** Next-action wording (Dutch). Override to match how the team talks. */
  labels: {
    cancelled: string;
    done: string;
    checkData: string;
    full: string;
    topUp: string;
    confirm: string;
    awaitReply: string;
    findChef: string;
  };
};

export const DEFAULT_ROSTER_SETTINGS: RosterSettings = {
  criticalHours: 24,
  labels: {
    cancelled: "Geannuleerd",
    done: "Afgerond",
    checkData: "Gegevens checken",
    full: "Vol",
    topUp: "Aanvullen",
    confirm: "Bevestig plaatsing",
    awaitReply: "Wacht op reactie",
    findChef: "Chef zoeken",
  },
};

function resolveSettings(s?: Partial<RosterSettings>): RosterSettings {
  return {
    criticalHours: s?.criticalHours ?? DEFAULT_ROSTER_SETTINGS.criticalHours,
    labels: { ...DEFAULT_ROSTER_SETTINGS.labels, ...s?.labels },
  };
}

export type ShiftIntelInput = {
  startsAt: Date | string;
  endsAt: Date | string;
  status: string;
  headcount: number;
  confirmedCount: number;
  proposedCount?: number;
  acceptedCount?: number;
  location?: string | null;
  city?: string | null;
  hasClient?: boolean;
  /** Per-employee overrides (from the Instellingen page). Defaults applied if omitted. */
  settings?: Partial<RosterSettings>;
  /** Override "now" for testing. */
  now?: Date;
};

function ctx(input: ShiftIntelInput) {
  const now = input.now ?? new Date();
  const { criticalHours } = resolveSettings(input.settings);
  const start = toDate(input.startsAt).getTime();
  const ended = toDate(input.endsAt).getTime() < now.getTime();
  const hasHeadcount = input.headcount > 0;
  const hasLocation = Boolean(input.location || input.city);
  const startsSoon = start - now.getTime() <= criticalHours * 60 * 60 * 1000;
  return { now, ended, hasHeadcount, hasLocation, startsSoon };
}

/** Operational health — the roster's colour language, not raw status. */
export function getShiftHealth(input: ShiftIntelInput): ShiftHealth {
  const { ended, hasHeadcount, hasLocation, startsSoon } = ctx(input);
  if (input.status === "cancelled") return "cancelled";
  if (input.status === "completed" || ended) return "done";
  if (!hasHeadcount) return "attention"; // "Geen bezetting ingesteld" = data gap
  if (input.confirmedCount >= input.headcount) {
    return hasLocation ? "healthy" : "attention";
  }
  if (startsSoon) return "critical";
  if (input.confirmedCount === 0) return "empty";
  return "underfilled";
}

/** The single most useful thing Maarten should do next, in Dutch (tunable labels). */
export function getShiftNextAction(input: ShiftIntelInput): string {
  const { ended, hasHeadcount, hasLocation } = ctx(input);
  const L = resolveSettings(input.settings).labels;
  if (input.status === "cancelled") return L.cancelled;
  if (input.status === "completed" || ended) return L.done;
  if (input.hasClient === false || !hasLocation || !hasHeadcount) return L.checkData;
  if (input.confirmedCount >= input.headcount) return L.full;
  if (input.confirmedCount > 0) return L.topUp;
  // nothing confirmed yet
  if ((input.acceptedCount ?? 0) > 0) return L.confirm;
  if ((input.proposedCount ?? 0) > 0) return L.awaitReply;
  return L.findChef;
}

/** Data-quality / risk chips (≤2 shown on a card; full list elsewhere). */
export function getShiftWarnings(input: ShiftIntelInput): string[] {
  const warnings: string[] = [];
  if (input.hasClient === false) warnings.push("Onbekende klant");
  if (!(input.location || input.city)) warnings.push("Locatie ontbreekt");
  if (!(input.headcount > 0)) warnings.push("Geen bezetting ingesteld");
  return warnings;
}

/** Tone for the `confirmed/headcount` fill badge. */
export function getFillState(input: ShiftIntelInput): FillState {
  const { ended, hasHeadcount, startsSoon } = ctx(input);
  if (input.status === "cancelled") return "cancelled";
  if (input.status === "completed" || ended) return "done";
  if (!hasHeadcount) return "unknown";
  if (input.confirmedCount >= input.headcount) return "full";
  if (input.confirmedCount === 0) return startsSoon ? "emptySoon" : "empty";
  return "partial";
}

/** Whether a shift belongs in the "Aandacht nodig" strip. */
export function needsAttention(input: ShiftIntelInput): boolean {
  const health = getShiftHealth(input);
  return (
    health === "critical" ||
    health === "empty" ||
    health === "underfilled" ||
    (health === "attention" && getShiftWarnings(input).length > 0)
  );
}
