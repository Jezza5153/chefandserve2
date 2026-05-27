import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { auth, signIn } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import { defaultLandingFor } from "@/lib/permissions";
import {
  checkRateLimit,
  extractClientIp,
} from "@/lib/rate-limit";

/**
 * Real magic-link login page.
 *
 * Pipeline:
 *   1. validate email shape                     → error=invalid-email
 *   2. (PR-S1B) Turnstile token verification    → error=turnstile (deferred to PR-S1B)
 *   3. PR-S1A rate-limit per-email scope        → error=too-many
 *   4. PR-S1A rate-limit per-ip scope           → error=too-many
 *   5. signIn("resend") — Auth.js sends magic link via Resend
 *   6. redirect to /verify (same UI for known/unknown to avoid enumeration)
 *
 * Unknown / non-active emails are rejected silently by the signIn callback.
 */
export const metadata: Metadata = {
  title: "Inloggen",
  description: "Toegang voor interne gebruikers van Chef & Serve.",
};

async function sendMagicLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    redirect("/login?error=invalid-email");
  }

  // PR-S1A: two-gate rate limit. Scopes never mix identifiers — see plan.
  const ip = extractClientIp(await headers());

  const emailGate = await checkRateLimit("magic_link_email", email);
  if (!emailGate.ok) {
    await db
      .insert(auditLog)
      .values({
        action: "auth.rate_limited",
        resource: "auth",
        // No raw email/IP — the audit row is itself non-PII
        after: { scope: "magic_link_email", retryAfterSec: emailGate.retryAfterSec },
      })
      .catch(() => {
        /* audit best-effort; never block on its failure */
      });
    redirect(`/login?error=too-many&retry=${emailGate.retryAfterSec}`);
  }

  const ipGate = await checkRateLimit("magic_link_ip", ip);
  if (!ipGate.ok) {
    await db
      .insert(auditLog)
      .values({
        action: "auth.rate_limited",
        resource: "auth",
        after: { scope: "magic_link_ip", retryAfterSec: ipGate.retryAfterSec },
      })
      .catch(() => {});
    redirect(`/login?error=too-many&retry=${ipGate.retryAfterSec}`);
  }

  try {
    await signIn("resend", {
      email,
      redirect: false, // we control the redirect below
    });
    redirect(`/verify?email=${encodeURIComponent(email)}`);
  } catch (err) {
    // Don't reveal whether the email exists. Same error UI for known/unknown.
    if (err instanceof AuthError) {
      redirect("/verify?email=" + encodeURIComponent(email));
    }
    throw err;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;

  // Already signed in? Skip the form entirely and send them to their landing
  // page. This is what unblocks the "magic link → bounced back to /login"
  // loop — Auth.js v5's default post-callback redirect target is the page
  // that initiated the sign-in, which is usually /login itself.
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
        Toegang is voorbehouden aan interne gebruikers van Chef &amp; Serve.
        Vul je e-mailadres in en we sturen een eenmalige inloglink — geen
        wachtwoord nodig.
      </p>

      <form
        action={sendMagicLink}
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

        {errorMsg && (
          <p className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
            {errorMsg}
          </p>
        )}

        <button
          type="submit"
          className="w-full rounded-full bg-burgundy px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
        >
          Stuur inloglink
        </button>
      </form>

      <p className="mt-8 text-xs leading-relaxed text-ink-500">
        Onbekende of nog niet geactiveerde adressen ontvangen geen mail —
        neem contact op met Jezza of Maarten als je geen toegang krijgt.
      </p>
    </div>
  );
}
