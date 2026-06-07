import type { Shift } from "@/lib/db/schema";

/**
 * Shift summary card — pure presentational. Relocated verbatim from the
 * "Summary card" block in shifts/[id]/page.tsx. `shift` + `confirmedCount` were
 * closures over the page; they are now props with the same names so the moved
 * JSX stays character-identical.
 */
export function SummaryCard({
  shift,
  confirmedCount,
}: {
  shift: Shift;
  confirmedCount: number;
}) {
  return (
    <div className="mt-8 grid gap-4 rounded-lg border border-ink-200 bg-white p-6 md:grid-cols-3">
      <SummaryCell label="Aantal nodig" value={shift.headcount.toString()} />
      <SummaryCell
        label="Bevestigd"
        value={`${confirmedCount} / ${shift.headcount}`}
        highlight={confirmedCount >= shift.headcount}
      />
      <SummaryCell
        label="Tarief klant"
        value={shift.clientRateCents ? `€${(shift.clientRateCents / 100).toFixed(2)}/u` : "—"}
      />
      <SummaryCell
        label="Tarief chef"
        value={shift.chefRateCents ? `€${(shift.chefRateCents / 100).toFixed(2)}/u` : "—"}
      />
      <SummaryCell label="Locatie" value={shift.location ?? "—"} />
    </div>
  );
}

function SummaryCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
        {label}
      </p>
      <p
        className={`mt-1 font-serif text-base ${
          highlight ? "text-emerald-700" : "text-ink-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
