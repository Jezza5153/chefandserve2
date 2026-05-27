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
        Vul je e-mailadres, wachtwoord en 2FA-code in. Geen wachtwoord (nog)?
        Vraag een eenmalige inloglink aan onderaan.
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

        <div>
          <label
            htmlFor="password"
            className="mb-2 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy"
          >
            Wachtwoord
          </label>
          <input
            type="password"
            id="password"
            name="password"
            autoComplete="current-password"
            placeholder="Alleen voor admin-accounts"
            className="w-full rounded border border-ink-200 bg-white px-4 py-3 font-mono text-base text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </div>

        <div>
          <label
            htmlFor="totp"
            className="mb-2 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy"
          >
            2FA-code
          </label>
          <input
            type="text"
            id="totp"
            name="totp"
            inputMode="text"
            maxLength={16}
            autoComplete="one-time-code"
            placeholder="123 456 of recovery code"
            className="w-full rounded border border-ink-200 bg-white px-4 py-3 font-mono text-base tracking-wider text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </div>

        {errorMsg && (
          <p className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
            {errorMsg}
          </p>
        )}

        <TurnstileWidget siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />

        <button
          type="submit"
          formAction={passwordLogin}
          className="w-full rounded-full bg-burgundy px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
        >
          Inloggen
        </button>

        <div className="relative my-4">
          <hr className="border-ink-200" />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-3 font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
            of
          </span>
        </div>

        <button
          type="submit"
          formAction={sendMagicLink}
          className="w-full rounded-full border border-burgundy/40 bg-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-burgundy transition-colors hover:bg-burgundy/5"
        >
          Stuur eenmalige inloglink
        </button>
      </form>

      <p className="mt-8 text-xs leading-relaxed text-ink-500">
        Chefs en klanten gebruiken altijd de eenmalige inloglink. Admin-accounts
        kunnen inloggen met wachtwoord + 2FA na de eerste setup. Onbekende of
        nog niet geactiveerde adressen ontvangen geen mail — neem contact op
        met Jezza of Maarten als je geen toegang krijgt.
      </p>
    </div>
  );
}
