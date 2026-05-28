/**
 * /login/forgot-password — entry to password-recovery flow (PR-C).
 *
 * Internal users only. The user types their email + Turnstile. We:
 *   1. Run rate-limit gates (magic_link_email + magic_link_ip — reuses
 *      scopes so attackers can't spam this endpoint to bypass /login's
 *      limits)
 *   2. Validate Turnstile token
 *   3. Call requestRecovery({ intent: 'password' }) — silent for unknown
 *      or non-internal emails. No enumeration.
 *   4. Redirect to /verify?email=… (same UI as magic-link send)
 *
 * The recovery email is purpose-bound: the token works ONLY on
 * /recover/password and cannot be substituted for a magic-link or 2FA
 * recovery (Fence 5).
 */

import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { TurnstileWidget } from "@/components/auth/TurnstileWidget";
import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import { errorLog } from "@/lib/db/schema";
import { requestRecovery } from "@/lib/domain/recovery";
import { env } from "@/lib/env";
import { checkRateLimit, extractClientIp } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";

export const metadata: Metadata = {
  title: "Wachtwoord vergeten",
  description: "Stel een nieuw wachtwoord in voor je Chef & Serve account.",
  robots: { index: false },
};

async function submit(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    redirect("/login/forgot-password?error=invalid-email");
  }

  const reqHeaders = await headers();
  const ip = extractClientIp(reqHeaders);

  // Turnstile.
  const tsToken = String(formData.get("cf-turnstile-response") ?? "");
  const tsResult = await verifyTurnstileToken({ token: tsToken, remoteIp: ip });
  if (!tsResult.ok) {
    await db
      .insert(errorLog)
      .values({
        message: `Turnstile rejected (recovery): ${tsResult.codes.join(",")}`,
        severity: "warning",
        url: "/login/forgot-password",
        context: { codes: tsResult.codes, reason: tsResult.reason },
      })
      .catch(() => {});
    redirect("/login/forgot-password?error=turnstile");
  }

  // Rate-limit per email + per ip. We reuse the magic_link_* scopes on
  // purpose: an attacker shouldn't be able to bypass /login's per-email
  // ceiling by switching to /login/forgot-password.
  const emailGate = await checkRateLimit("magic_link_email", email);
  if (!emailGate.ok) {
    await recordAuditFromRequest({
      action: "auth.rate_limited",
      resource: "auth",
      after: { scope: "magic_link_email", origin: "forgot-password" },
    })
      .catch(() => {});
    redirect(
      `/login/forgot-password?error=too-many&retry=${emailGate.retryAfterSec}`,
    );
  }
  const ipGate = await checkRateLimit("magic_link_ip", ip);
  if (!ipGate.ok) {
    await recordAuditFromRequest({
      action: "auth.rate_limited",
      resource: "auth",
      after: { scope: "magic_link_ip", origin: "forgot-password" },
    })
      .catch(() => {});
    redirect(
      `/login/forgot-password?error=too-many&retry=${ipGate.retryAfterSec}`,
    );
  }

  // Derive the public origin from request headers so the recovery URL
  // points back to the same host the user is on (handles preview deploys).
  const host = reqHeaders.get("host") ?? "chefandserve.nl";
  const proto = reqHeaders.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  await requestRecovery({ email, intent: "password", origin });

  // Same UI as magic-link send — no enumeration of valid emails.
  redirect(`/verify?email=${encodeURIComponent(email)}`);
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; retry?: string }>;
}) {
  const params = await searchParams;
  const errorMsg =
    params.error === "invalid-email"
      ? "Vul een geldig e-mailadres in."
      : params.error === "turnstile"
        ? "Beveiligingscontrole mislukt. Probeer het opnieuw."
        : params.error === "too-many"
          ? "Te veel pogingen — probeer het over enkele minuten opnieuw."
          : null;

  return (
    <div className="mx-auto w-full max-w-md rounded-lg border border-burgundy/15 bg-white p-8 md:p-10">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Account herstel
      </p>
      <h1 className="mt-3 font-serif text-3xl text-ink-900 md:text-4xl">
        Wachtwoord vergeten?
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-700">
        Vul je e-mailadres in. We sturen je een herstellink. In de
        volgende stap heb je je huidige <strong>2FA-code</strong> nodig om
        een nieuw wachtwoord in te stellen — als je ook geen toegang hebt
        tot je authenticator, gebruik dan{" "}
        <Link
          href="/login/lost-2fa"
          className="text-burgundy underline-offset-4 hover:underline"
        >
          de 2FA-herstelflow
        </Link>
        .
      </p>

      <form action={submit} className="mt-8 space-y-4">
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

        {errorMsg && (
          <p className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
            {errorMsg}
          </p>
        )}

        <TurnstileWidget siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />

        <button
          type="submit"
          className="w-full rounded-full bg-burgundy px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
        >
          Stuur herstellink
        </button>
      </form>

      <p className="mt-8 text-xs text-ink-500">
        <Link
          href="/login"
          className="text-burgundy underline-offset-4 hover:underline"
        >
          ← Terug naar inloggen
        </Link>
      </p>
    </div>
  );
}
