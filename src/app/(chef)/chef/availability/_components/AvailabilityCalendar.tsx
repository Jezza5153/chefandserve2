"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Props = {
  weeks: number; // typically 8
  /** Server-side set of ISO YYYY-MM-DD strings that are currently BLOCKED. */
  initialBlockedDates: string[];
  /** Server action that flips a single date. */
  toggleDate: (isoDate: string, blocked: boolean) => Promise<void>;
  /** Server action that flips a range. */
  setRange: (startIso: string, endIso: string, blocked: boolean) => Promise<void>;
};

const WEEKDAY_LABELS = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const MONTH_LABELS = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeekMonday(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const day = (out.getDay() + 6) % 7; // 0=Mon … 6=Sun
  out.setDate(out.getDate() - day);
  return out;
}

export function AvailabilityCalendar({
  weeks,
  initialBlockedDates,
  toggleDate,
  setRange,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [blocked, setBlocked] = useState(() => new Set(initialBlockedDates));
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const start = useMemo(() => startOfWeekMonday(today), [today]);

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push(d);
    }
    return out;
  }, [start, weeks]);

  async function flip(date: Date) {
    setError(null);
    if (date < today) return;
    const iso = isoDate(date);
    const wasBlocked = blocked.has(iso);
    const nextBlocked = !wasBlocked;

    // Optimistic update
    const optimistic = new Set(blocked);
    if (nextBlocked) optimistic.add(iso);
    else optimistic.delete(iso);
    setBlocked(optimistic);

    startTransition(async () => {
      try {
        await toggleDate(iso, nextBlocked);
        router.refresh();
      } catch (e) {
        // Rollback
        setBlocked(blocked);
        setError(e instanceof Error ? e.message : "Kon niet opslaan");
      }
    });
  }

  async function handleClick(date: Date, shift: boolean) {
    if (date < today) return;
    const iso = isoDate(date);

    if (shift && rangeStart) {
      // Range select — figure out the end (chronological)
      const startIso = rangeStart < iso ? rangeStart : iso;
      const endIso = rangeStart < iso ? iso : rangeStart;
      setRangeStart(null);
      setError(null);
      // Optimistic: block every date in the range
      const optimistic = new Set(blocked);
      const cur = new Date(startIso);
      const end = new Date(endIso);
      while (cur <= end) {
        optimistic.add(isoDate(cur));
        cur.setDate(cur.getDate() + 1);
      }
      setBlocked(optimistic);
      startTransition(async () => {
        try {
          await setRange(startIso, endIso, true);
          router.refresh();
        } catch (e) {
          setBlocked(blocked);
          setError(e instanceof Error ? e.message : "Kon niet opslaan");
        }
      });
    } else if (shift) {
      setRangeStart(iso);
    } else {
      flip(date);
    }
  }

  // Group days by month for headings
  const months = useMemo(() => {
    const groups: { key: string; label: string; days: Date[] }[] = [];
    for (const d of days) {
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const existing = groups.find((g) => g.key === key);
      if (existing) existing.days.push(d);
      else
        groups.push({
          key,
          label: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`,
          days: [d],
        });
    }
    return groups;
  }, [days]);

  return (
    <div>
      <div className="rounded-lg border border-burgundy/15 bg-burgundy/5 p-4 text-xs leading-relaxed text-ink-700">
        <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
          Tip
        </p>
        <p className="mt-1">
          <strong>Klik</strong> een dag om hem te blokkeren (rood) of weer
          beschikbaar te maken (groen). <strong>Shift-klik</strong> om twee
          dagen te selecteren — alles ertussen wordt geblokkeerd
          (handig voor vakantie).
        </p>
      </div>

      {error && (
        <p className="mt-3 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
          ⚠ {error}
        </p>
      )}

      <div className="mt-6 space-y-8">
        {months.map((m) => (
          <section key={m.key}>
            <h2 className="font-serif text-xl text-ink-900">{m.label}</h2>
            <div
              className="mt-3 grid gap-1 text-center"
              style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
            >
              {WEEKDAY_LABELS.map((w) => (
                <div
                  key={w}
                  className="py-1 font-ui text-[9px] uppercase tracking-wider text-ink-500"
                >
                  {w}
                </div>
              ))}
              {/* Pad until the first day's weekday */}
              {(() => {
                const firstDay = m.days[0];
                const pad = (firstDay.getDay() + 6) % 7; // Mon=0
                return Array.from({ length: pad }).map((_, i) => (
                  <div key={`pad-${i}`} />
                ));
              })()}
              {m.days.map((d) => {
                const iso = isoDate(d);
                const isPast = d < today;
                const isToday = d.getTime() === today.getTime();
                const isBlocked = blocked.has(iso);
                const isRangeStart = rangeStart === iso;
                // Today ring beats the range ring (range ring still wins
                // if the user explicitly shift-clicked today as the anchor).
                const ring = isRangeStart
                  ? "ring-2 ring-burgundy ring-offset-1"
                  : isToday
                    ? "ring-2 ring-ink-900 ring-offset-1"
                    : "";
                return (
                  <button
                    key={iso}
                    type="button"
                    disabled={isPast || pending}
                    onClick={(e) => handleClick(d, e.shiftKey)}
                    className={`aspect-square rounded text-xs font-medium transition-all ${
                      isPast
                        ? "cursor-not-allowed bg-bg-gray text-ink-200"
                        : isBlocked
                          ? "bg-burgundy text-white hover:bg-burgundy-900"
                          : "bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                    } ${ring}`}
                    title={
                      isPast
                        ? "Verleden"
                        : isToday
                          ? "Vandaag"
                          : isBlocked
                            ? "Niet beschikbaar"
                            : "Beschikbaar"
                    }
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-ink-700">
        <span className="flex items-center gap-2">
          <span className="inline-block size-3 rounded bg-emerald-50 ring-1 ring-emerald-200" />
          Beschikbaar
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block size-3 rounded bg-burgundy" />
          Niet beschikbaar
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block size-3 rounded bg-bg-gray" />
          Verleden
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block size-3 rounded bg-emerald-50 ring-2 ring-ink-900" />
          Vandaag
        </span>
        {pending && <span className="text-burgundy">Opslaan…</span>}
      </div>
    </div>
  );
}
