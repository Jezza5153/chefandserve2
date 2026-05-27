/**
 * TrustTimeline — PR-CHEF-1.
 *
 * The visual chain that appears on every shift_hours row across chef/klant/admin.
 *
 *   ●━━━●━━━●━━━○━━━○
 *   Chef    Klant   Chef&Serve   Uitbetaling   Betaald
 *   ✓ 21mei ✓ 22mei  ⏳ wacht    ○ later       ○ later
 *
 * Mobile-first: at <480px, dots become vertical stack with labels on the
 * right. The chain length is ALWAYS 5 dots — never collapsed — so users get
 * predictable progress signaling.
 *
 * Server component — pure data render, no client interactivity.
 */

import type { TimelineStep } from "@/lib/hours-labels";

export function TrustTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-4">
      {/* Desktop: horizontal */}
      <div className="hidden sm:block">
        <div className="flex items-center justify-between">
          {steps.map((step, i) => (
            <DotWithConnector key={step.key} step={step} isLast={i === steps.length - 1} />
          ))}
        </div>
        <div className="mt-3 flex items-start justify-between gap-2">
          {steps.map((step) => (
            <StepLabel key={step.key} step={step} />
          ))}
        </div>
      </div>

      {/* Mobile: vertical */}
      <ol className="space-y-3 sm:hidden">
        {steps.map((step) => (
          <li key={step.key} className="flex items-start gap-3">
            <Dot state={step.state} />
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-tight text-ink-900">{step.label}</p>
              <p className="mt-0.5 text-xs text-ink-500">
                {formatStepStatus(step)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------- bits ----------------------------------------------------- */

function DotWithConnector({
  step,
  isLast,
}: {
  step: TimelineStep;
  isLast: boolean;
}) {
  return (
    <div className="flex flex-1 items-center">
      <Dot state={step.state} />
      {isLast ? null : (
        <span
          className={`mx-1 h-0.5 flex-1 ${
            step.state === "done"
              ? "bg-burgundy"
              : step.state === "rejected"
                ? "bg-burgundy/40"
                : "bg-ink-200"
          }`}
        />
      )}
    </div>
  );
}

function Dot({
  state,
}: {
  state: "done" | "current" | "future" | "rejected";
}) {
  const base = "inline-block size-3 shrink-0 rounded-full border-2";
  switch (state) {
    case "done":
      return <span className={`${base} border-burgundy bg-burgundy`} />;
    case "current":
      return (
        <span
          className={`${base} animate-pulse border-burgundy bg-amber-300`}
        />
      );
    case "rejected":
      return <span className={`${base} border-burgundy bg-burgundy/30`} />;
    case "future":
      return <span className={`${base} border-ink-300 bg-white`} />;
  }
}

function StepLabel({ step }: { step: TimelineStep }) {
  return (
    <div className="flex-1 text-center">
      <p className="text-[10px] font-medium uppercase tracking-wider text-ink-700">
        {step.label}
      </p>
      <p className="mt-0.5 text-[10px] text-ink-500">{formatStepStatus(step)}</p>
    </div>
  );
}

function formatStepStatus(step: TimelineStep): string {
  switch (step.state) {
    case "done":
      return step.at
        ? `✓ ${new Date(step.at).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}`
        : "✓";
    case "current":
      return "⏳ wacht";
    case "rejected":
      return "✗ teruggezet";
    case "future":
      return "○ later";
  }
}
