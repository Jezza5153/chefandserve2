import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { TurnstileWidget } from "@/components/auth/TurnstileWidget";
import { auth, signIn } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { auditLog, errorLog } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { defaultLandingFor } from "@/lib/permissions";
import {
  checkRateLimit,
  extractClientIp,
} from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";

/**
 * Login page — dual flow.
 *
 * PR-S2E: a single form with three fields (email, password, 2FA code) +
 * two submit buttons:
 *
 *  - Primary "Inloggen" → password+TOTP path (Credentials provider).
 *    Internal staff after the wizard use this.
 *
 *  - Secondary "Stuur eenmalige inloglink" → magic-link path (Resend).
 *    Chefs/klanten use this. Internal users who haven't enrolled yet
 *    also use this — first login bounces to /admin/account/setup.
 *
 * Both gates run rate-limit (PR-S1A) + Turnstile (PR-S1B). Both honor
 * the seed-only rule via the signIn callback in auth.ts.
 */
export const metadata: Metadata = {
  title: "Inloggen",
  description: "Toegang voor interne gebruikers van Chef & Serve.",
};

/* -------- shared gates ---------------------------------------------- */

async function runGates(
  email: string,
  formData: FormData,
): Promise<void> {
  const reqHeaders = await headers();
  const ip = extractClientIp(reqHeaders);

  // Turnstile (graceful no-op if env vars missing).
  const tsToken = String(formData.get("cf-turnstile-response") ?? "");
  const tsResult = await verifyTurnstileToken({
    token: tsToken,
    remoteIp: ip,
  });
  if (!tsResult.ok) {
    await db
      .insert(errorLog)
      .values({
        message: `Turnstile rejected: ${tsResult.codes.join(",")}`,
        severity: "warning",
        url: "/login",
        context: { codes: tsResult.codes, reason: tsResult.reason },
      })
      .catch(() => {});
    redirect("/login?error=turnstile");
  }

  // Two-gate rate limit. Scopes never mix identifiers.
  const emailGate = await checkRateLimit("magic_link_email", email);
  if (!emailGate.ok) {
    await db
      .insert(auditLog)
      .values({
        action: "auth.rate_limited",
        resource: "auth",
        after: {
          scope: "magic_link_email",
          retryAfterSec: emailGate.retryAfterSec,
        },
      })
      .catch(() => {});
    redirect(`/login?error=too-many&retry=${emailGate.retryAfterSec}`);
  }
  const ipGate = await checkRateLimit("magic_link_ip", ip);
  if (!ipGate.ok) {
    await db
      .insert(auditLog)
      .values({
        action: "auth.rate_limited",
        resource: "auth",
        after: {
          scope: "magic_link_ip",
          retryAfterSec: ipGate.retryAfterSec,
        },
      })
      .catch(() => {});
    redirect(`/login?error=too-many&retry=${ipGate.retryAfterSec}`);
  }
}

/* -------- server actions -------------------------------------------- */

async function passwordLogin(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const totp = String(formData.get("totp") ?? "").trim();

  if (!email || !email.includes("@")) {
    redirect("/login?error=invalid-email");
  }
  if (!password || !totp) {
    redirect("/login?error=password-missing-fields");
  }

  await runGates(email, formData);

  try {
    await signIn("password-totp", {
      email,
      password,
      totp,
      redirect: false,
    });
    redirect("/admin");
  } catch (err) {
    // CredentialsSignin or other AuthError → generic error. Don't reveal
    // whether the password or the TOTP code was the failing factor.
    if (err instanceof AuthError) {
      redirect("/login?error=bad-credentials");
    }
    throw err;
  }
}

async function sendMagicLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    redirect("/login?error=invalid-email");
  }

  await runGates(email, formData);

  try {
    await signIn("resend", {
      email,
      redirect: false,
    });
    redirect(`/verify?email=${encodeURIComponent(email)}`);
  } catch (err) {
    if (err instanceof AuthError) {
      // Same UI for known/unknown — no enumeration.
      redirect("/verify?email=" + encodeURIComponent(email));
    }
    throw err;
  }
}

/* -------- page -------------------------------------------------------- */

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;

  // Already signed in? Bypass.
  const session = await auth();
  if (session?.user) {
    const dest =
      params.next && params.next.startsWith("/")
        ? params.next
        : defaultLandingFor(session.user.roles ?? []);
    redirect(dest);
  }

  const errorMsg =
    params.error === "invalid-email"
      ? "Vul een geldig e-mailadres in."
      : params.error === "too-many"
        ? "Te veel inlogpogingen — probeer het over enkele minuten opnieuw."
        : params.error === "turnstile"
          ? "Beveiligingscontrole mislukt. Probeer het opnieuw."
          : params.error === "bad-credentials"
            ? "Inloggen mislukt. Controleer je e-mail, wachtwoord en 2FA-code."
            : params.error === "password-missing-fields"
              ? "Vul alle drie de velden in om met wachtwoord in te loggen. Geen wachtwoord? Gebruik de eenmalige inloglink."
              : null;

  return (
    <div className="mx-auto w-full max-w-md rounded-lg border border-burgundy/15 bg-white p-8 md:p-10">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Inloggen
      </p>
      <h1 className="mt-3 font-serif text-3xl text-ink-900 md:text-4xl">
        Welkom terug
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-700">
        Vul je e-mailadres in en we sturen je een eenmalige inloglink.
        Geen wachtwoord nodig.
      </p>

      <form
        className="mt-8 space-y-4"
        aria-label="Inlogformulier"
      >
        <div>
          <label
            htmlFor="email"
            className="mb-2 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy"
          >
            E-mailadres
          </label>
          <input
            type="email"
            id="email"
            name="email"
            placeholder="jij@chefandserve.nl"
            required
            autoComplete="email"
            autoFocus
            className="w-full rounded border border-ink-200 bg-white px-4 py-3 text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </div>

        {/* Password + TOTP fields — hidden behind toggle so first-time
            visitors aren't intimidated by them. Internal staff who have
            completed the wizard click "Heb je al een wachtwoord?" to open. */}
        <details
          className="rounded border border-ink-200 bg-bg-gray px-4 py-3 text-sm"
          // The browser remembers the open state per-page-load. For "remembered
          // across visits" we'd need a tiny client component reading
          // sessionStorage; not worth the round-trip in V1.
        >
          <summary className="cursor-pointer font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline">
            Heb je al een wachtwoord ingesteld?
          </summary>
          <div className="mt-4 space-y-3">
            <p className="text-xs leading-relaxed text-ink-700">
              Voor interne medewerkers met wachtwoord + 2FA. Chefs en klanten
              gebruiken altijd de eenmalige inloglink hierboven.
            </p>
            <div>
              <label
                htmlFor="password"
                className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy"
              >
                Wachtwoord
              </label>
              <input
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
          </div>
        </details>

        {errorMsg && (
          <p className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
            {errorMsg}
          </p>
        )}

        <TurnstileWidget siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />

        {/* Primary action: magic-link. Most logins use this (chef + klant
            always; internal staff before wizard; internal staff who don't
            want to type the password). */}
        <button
          type="submit"
          formAction={sendMagicLink}
          className="w-full rounded-full bg-burgundy px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
        >
          Stuur eenmalige inloglink
        </button>

        {/* Secondary action: password+TOTP. Only useful after wizard is
            complete AND the user toggled open the password fields above. */}
        <button
          type="submit"
          formAction={passwordLogin}
          className="w-full rounded-full border border-burgundy/40 bg-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-burgundy transition-colors hover:bg-burgundy/5"
        >
          Inloggen met wachtwoord + 2FA
        </button>
      </form>

      <p className="mt-8 text-xs leading-relaxed text-ink-500">
        Chefs en klanten gebruiken altijd de eenmalige inloglink. Interne
        medewerkers kunnen na hun eerste setup ook met wachtwoord + 2FA
        inloggen. Onbekende of nog niet geactiveerde adressen ontvangen
        geen mail.
      </p>
    </div>
  );
}
