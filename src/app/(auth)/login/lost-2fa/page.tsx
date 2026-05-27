/**
 * /login/lost-2fa — entry to 2FA-recovery flow (PR-C).
 *
 * Internal users only. The user types email + Turnstile. We:
 *   1. Run rate-limit gates (magic_link_email + magic_link_ip)
 *   2. Validate Turnstile token
 *   3. Call requestRecovery({ intent: 'totp' })
 *   4. Redirect to /verify?email=… (no enumeration)
 *
 * The recovery email's token is purpose-bound: only works on /recover/2fa.
 * On that page the user enters a recovery code. Consuming the code wipes
 * the user's TOTP secret + remaining codes; they then magic-link in and
 * re-enroll via the wizard.
 */

import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { TurnstileWidget } from "@/components/auth/TurnstileWidget";
import { db } from "@/lib/db/client";
import { auditLog, errorLog } from "@/lib/db/schema";
import { requestRecovery } from "@/lib/domain/recovery";
import { env } from "@/lib/env";
import { checkRateLimit, extractClientIp } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";

export const metadata: Metadata = {
  title: "Geen toegang tot je 2FA?",
  description: "Herstel je 2FA-instelling met een recovery code.",
  robots: { index: false },
};

async function submit(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    redirect("/login/lost-2fa?error=invalid-email");
  }

  const reqHeaders = await headers();
  const ip = extractClientIp(reqHeaders);

  const tsToken = String(formData.get("cf-turnstile-response") ?? "");
  const tsResult = await verifyTurnstileToken({ token: tsToken, remoteIp: ip });
  if (!tsResult.ok) {
    await db
      .insert(errorLog)
      .values({
        message: `Turnstile rejected (lost-2fa): ${tsResult.codes.join(",")}`,
        severity: "warning",
        url: "/login/lost-2fa",
        context: { codes: tsResult.codes, reason: tsResult.reason },
      })
      .catch(() => {});
    redirect("/login/lost-2fa?error=turnstile");
  }

  const emailGate = await checkRateLimit("magic_link_email", email);
  if (!emailGate.ok) {
    await db
      .insert(auditLog)
      .values({
        action: "auth.rate_limited",
        resource: "auth",
        after: { scope: "magic_link_email", origin: "lost-2fa" },
      })
      .catch(() => {});
    redirect(
      `/login/lost-2fa?error=too-many&retry=${emailGate.retryAfterSec}`,
    );
  }
  const ipGate = await checkRateLimit("magic_link_ip", ip);
  if (!ipGate.ok) {
    await db
      .insert(auditLog)
      .values({
        action: "auth.rate_limited",
        resource: "auth",
        after: { scope: "magic_link_ip", origin: "lost-2fa" },
      })
      .catch(() => {});
    redirect(
      `/login/lost-2fa?error=too-many&retry=${ipGate.retryAfterSec}`,
    );
  }

  const host = reqHeaders.get("host") ?? "chefandserve.nl";
  const proto = reqHeaders.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  await requestRecovery({ email, intent: "totp", origin });

  redirect(`/verify?email=${encodeURIComponent(email)}`);
}

export default async function LostTwoFAPage({
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
        Geen toegang tot je 2FA?
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-700">
        Vul je e-mailadres in — we sturen je een herstellink. In de
        volgende stap heb je één van je <strong>recovery codes</strong> nodig
        (formaat <code>ABCD-EFGH-IJKL</code>). Daarna richt je via de wizard
        opnieuw 2FA in.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-ink-700">
        Ook geen recovery codes meer? Neem contact op met een collega
        super_admin — die kan via{" "}
        <span className="font-mono text-xs">/admin/system/users</span> je 2FA
        resetten.
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
