"use client";

import { useRef, useState } from "react";

/**
 * Password + 2FA disclosure for the login page.
 *
 * The fix (login-password-disclosure): previously the password/TOTP inputs lived
 * in a collapsed <details> while a SEPARATE "Inloggen met wachtwoord + 2FA" submit
 * button sat below it. Clicking that button with the fields collapsed submitted an
 * empty password → bounced back with "vul alle drie de velden in", so the button
 * looked dead. Now the fields + their submit button live together: closed shows
 * only the toggle; the real submit button appears WITH the fields once opened (and
 * the inputs aren't in the DOM while closed, so there's no accidental empty submit).
 *
 * `passwordAction` is the page's server action, passed in as a prop (Next.js allows
 * server actions as client props for use in formAction).
 */
export function PasswordLogin({
  passwordAction,
  defaultOpen = false,
}: {
  passwordAction: (formData: FormData) => Promise<void>;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const pwRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded border border-ink-200 bg-bg-gray px-4 py-3 text-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) setTimeout(() => pwRef.current?.focus(), 0);
        }}
        className="flex w-full items-center justify-between gap-2 font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
      >
        <span>Heb je al een wachtwoord ingesteld?</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs leading-relaxed text-ink-700">
            Voor interne medewerkers met wachtwoord + 2FA. Chefs en klanten gebruiken
            altijd de eenmalige inloglink hierboven.
          </p>
          <div>
            <label
              htmlFor="password"
              className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy"
            >
              Wachtwoord
            </label>
            <input
              ref={pwRef}
              type="password"
              id="password"
              name="password"
              autoComplete="current-password"
              className="w-full rounded border border-ink-200 bg-white px-3 py-2 font-mono text-base text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
            />
          </div>
          <div>
            <label
              htmlFor="totp"
              className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy"
            >
              2FA-code (of recovery code)
            </label>
            <input
              type="text"
              id="totp"
              name="totp"
              inputMode="text"
              maxLength={16}
              autoComplete="one-time-code"
              placeholder="123 456 of ABCD-EFGH-IJKL"
              className="w-full rounded border border-ink-200 bg-white px-3 py-2 font-mono text-base tracking-wider text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
            />
          </div>
          <button
            type="submit"
            formAction={passwordAction}
            className="w-full rounded-full bg-burgundy px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
          >
            Inloggen met wachtwoord + 2FA
          </button>
        </div>
      ) : null}
    </div>
  );
}
