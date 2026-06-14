/**
 * Klant 360 verdict card — the top-of-page "goede klant?" answer (mirror of the chef
 * Inzetbaarheidskaart). Renders the pure computeClientHealth() verdict: a coloured headline +
 * one-line summary + green strength chips + amber watchpoint chips.
 */
import type { ClientHealthVerdict } from "@/lib/domain/client-health";

const TONE: Record<ClientHealthVerdict["level"], { box: string; dot: string; label: string }> = {
  sterk: { box: "border-emerald-300 bg-emerald-50", dot: "bg-emerald-500", label: "text-emerald-800" },
  goed: { box: "border-ink-200 bg-white", dot: "bg-ink-400", label: "text-ink-800" },
  aandacht: { box: "border-amber-300 bg-amber-50", dot: "bg-amber-500", label: "text-amber-900" },
};

export function ClientHealthCard({ verdict }: { verdict: ClientHealthVerdict }) {
  const t = TONE[verdict.level];
  return (
    <div className={`mt-4 rounded-lg border-2 p-5 ${t.box}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${t.dot}`} aria-hidden="true" />
        <h2 className={`font-serif text-xl ${t.label}`}>{verdict.headline}</h2>
      </div>
      <p className="mt-1 text-sm text-ink-700">{verdict.summary}</p>

      {verdict.strengths.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {verdict.strengths.map((s) => (
            <span key={s} className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
              ✓ {s}
            </span>
          ))}
        </div>
      )}
      {verdict.watchpoints.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {verdict.watchpoints.map((w) => (
            <span key={w} className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
              ⚠ {w}
            </span>
          ))}
        </div>
      )}
      {verdict.nextActions.length > 0 && (
        <div className="mt-3 border-t border-ink-200/60 pt-3">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Volgende stap</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {verdict.nextActions.map((a) => (
              <span key={a} className="rounded-full border border-burgundy/30 bg-burgundy/5 px-2.5 py-1 text-xs font-medium text-burgundy">
                → {a}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
