/**
 * Wizard chrome — three numbered steps. Each step page renders inside.
 */
import React from "react";

type Step = 1 | 2 | 3;

const STEPS: Array<{ n: Step; label: string }> = [
  { n: 1, label: "Wachtwoord" },
  { n: 2, label: "Authenticator" },
  { n: 3, label: "Recovery codes" },
];

export function WizardShell({
  current,
  children,
}: {
  current: Step;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Account setup · stap {current} van 3
      </p>

      <ol className="mt-4 flex items-center gap-3" aria-label="Voortgang">
        {STEPS.map((s) => {
          const state =
            s.n < current ? "done" : s.n === current ? "active" : "pending";
          return (
            <li key={s.n} className="flex items-center gap-3">
              <span
                aria-current={state === "active" ? "step" : undefined}
                className={`flex size-7 items-center justify-center rounded-full font-serif text-sm ${
                  state === "done"
                    ? "bg-emerald-100 text-emerald-700"
                    : state === "active"
                      ? "bg-burgundy text-white"
                      : "bg-bg-gray text-ink-500"
                }`}
              >
                {state === "done" ? "✓" : s.n}
              </span>
              <span
                className={`font-ui text-[10px] uppercase tracking-[0.18em] ${
                  state === "active" ? "text-ink-900" : "text-ink-500"
                }`}
              >
                {s.label}
              </span>
              {s.n < STEPS.length && (
                <span className="h-px w-6 bg-ink-200" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-10">{children}</div>
    </div>
  );
}
