/**
 * /recover/password?token=… — password reset via purpose-bound token.
 *
 * PR-C / Fence 5. Flow:
 *   1. Page loads → peekIntent(token, 'password') → if null, render "link
 *      expired" message (DON'T consume; user might re-open the email).
 *   2. Form: current TOTP code + new password + confirm.
 *   3. Submit → consumeIntent (atomic single-use). On miss → error.
 *   4. Verify TOTP against user's secret (or recovery code as fallback).
 *   5. Validate new password (policy + HIBP).
 *   6. UPDATE users SET password_hash=… , password_set_at=now(),
 *      permissions_version+=1, updated_at=now(). The version bump
 *      invalidates all OTHER active sessions on other devices (a
 *      password reset IS a security event).
 *   7. Audit auth.password_reset.
 *   8. Redirect to /login?reset=password so the user logs in with the
 *      new password (their session was just nuked).
 *
 * Critical: this page is NOT auth-gated. The token IS the credential for
 * reaching the form; TOTP is the credential for actually mutating state.
 * Email enumeration is impossible — only someone with the email link
 * (and a valid TOTP) can complete the flow.
 */

import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { auditLog, users } from "@/lib/db/schema";
import {
  hashPassword,
  PASSWORD_MIN_LENGTH,
  validatePassword,
} from "@/lib/passwords";
import { checkRateLimit, extractClientIp } from "@/lib/rate-limit";
import { verifyAndConsume as consumeRecoveryCode } from "@/lib/recovery-codes";
import { consumeIntent, peekIntent } from "@/lib/recovery-intents";
import { decryptSecret, verifyCode } from "@/lib/totp";

export const metadata = {
  title: "Stel een nieuw wachtwoord in",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

async function submit(formData: FormData) {
  "use server";

  const token = String(formData.get("token") ?? "");
  const totp = String(formData.get("totp") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  // Quick client-side-mirror checks before consuming the token. The token
  // is single-use; we DON'T want to burn it on a typo.
  if (!token) {
    redirect("/login?error=recovery-invalid");
  }
  if (!totp) {
    redirect(`/recover/password?token=${encodeURIComponent(token)}&error=missing-totp`);
  }
  if (!password || !confirm) {
    redirect(`/recover/password?token=${encodeURIComponent(token)}&error=missing-password`);
  }
  if (password !== confirm) {
    redirect(`/recover/password?token=${encodeURIComponent(token)}&error=mismatch`);
  }

  // Pre-check the password BEFORE consuming the token, so a bad password
  // doesn't burn the token either.
  const policy = await validatePassword(password);
  if (!policy.ok) {
    const errKey =
      policy.reason === "too-short"
        ? "too-short"
        : policy.reason === "breached"
          ? "breached"
          : "empty";
    redirect(`/recover/password?token=${encodeURIComponent(token)}&error=${errKey}`);
  }

  // Re-peek the intent — same checks the consume will do, but we want the
  // userId now so we can rate-limit and run TOTP verify BEFORE consuming.
  const peeked = await peekIntent(token, "password");
  if (!peeked) {
    redirect("/login?error=recovery-invalid");
  }

  // Rate-limit TOTP verify attempts on this user, mirroring /verify-2fa.
  const reqHeaders = await headers();
  const ip = extractClientIp(reqHeaders);
  const gate = await checkRateLimit("totp_verify", peeked.userId);
  if (!gate.ok) {
    await db
      .insert(auditLog)
      .values({
        userId: peeked.userId,
        action: "auth.totp_rate_limited",
        resource: "users",
        resourceId: peeked.userId,
        after: { origin: "recover/password", retryAfterSec: gate.retryAfterSec },
      })
      .catch(() => {});
    redirect(`/recover/password?token=${encodeURIComponent(token)}&error=too-many`);
  }

  // Verify TOTP — numeric first, recovery code fallback.
  const [u] = await db
    .select({
      id: users.id,
      email: users.email,
      totpSecretEncrypted: users.totpSecretEncrypted,
      totpEnabled: users.totpEnabled,
      permissionsVersion: users.permissionsVersion,
    })
    .from(users)
    .where(eq(users.id, peeked.userId))
    .limit(1);

  if (!u?.totpEnabled || !u.totpSecretEncrypted) {
    // Edge case: someone reset 2FA between intent creation and submit. The
    // token is still ours to consume so an attacker can't replay, but the
    // user needs a fresh flow.
    await consumeIntent(token, "password").catch(() => {});
    redirect("/login?error=recovery-totp-missing");
  }

  let ok = false;
  const cleaned = totp.replace(/\s+/g, "");
  if (/^\d{6}$/.test(cleaned)) {
    try {
      const secret = await decryptSecret(u.totpSecretEncrypted);
      ok = verifyCode(secret, cleaned);
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    ok = await consumeRecoveryCode(u.id, totp);
  }
  if (!ok) {
    await db
      .insert(auditLog)
      .values({
        userId: u.id,
        action: "auth.totp_verify_failed",
        resource: "users",
        resourceId: u.id,
        after: { origin: "recover/password", ip },
      })
      .catch(() => {});
    redirect(`/recover/password?token=${encodeURIComponent(token)}&error=wrong-totp`);
  }

  // TOTP good. Atomically consume the recovery intent.
  const consumed = await consumeIntent(token, "password");
  if (!consumed) {
    // Race: someone consumed it between peek and now. Fail closed.
    redirect("/login?error=recovery-invalid");
  }

  // All gates passed → reset password + bump permissions_version.
  const hash = await hashPassword(password);
  await db
    .update(users)
    .set({
      passwordHash: hash,
      passwordSetAt: new Date(),
      permissionsVersion: u.permissionsVersion + 1,
      updatedAt: new Date(),
    })
    .where(eq(users.id, u.id));

  await db.insert(auditLog).values({
    userId: u.id,
    action: "auth.password_reset",
    resource: "users",
    resourceId: u.id,
    after: { via: "recovery", emailMasked: maskEmail(u.email), ip },
  });

  redirect("/login?reset=password");
}

function maskEmail(e: string): string {
  // Keep the audit row useful but not raw-PII rich. Show first 2 chars + domain.
  const [local, domain] = e.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
}

export default async function RecoverPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const token = (sp.token ?? "").trim();

  // No token at all → bounce back to start of flow.
  if (!token) {
    redirect("/login/forgot-password");
  }

  // Peek (non-mutating) to confirm token is still valid before showing form.
  const peeked = await peekIntent(token, "password");
  if (!peeked) {
    return (
      <div className="mx-auto w-full max-w-md rounded-lg border border-burgundy/15 bg-white p-8 text-center md:p-10">
        <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Account herstel
        </p>
        <h1 className="mt-3 font-serif text-3xl text-ink-900 md:text-4xl">
          Link ongeldig
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-700">
          Deze herstellink is verlopen of al gebruikt. Vraag een nieuwe link
          aan via de wachtwoord-herstelflow.
        </p>
        <p className="mt-6 text-xs text-ink-500">
          <Link
            href="/login/forgot-password"
            className="text-burgundy underline-offset-4 hover:underline"
          >
            ← Nieuwe herstellink aanvragen
          </Link>
        </p>
      </div>
    );
  }

  const errorMsg =
    sp.error === "missing-totp"
      ? "Vul je 2FA-code in."
      : sp.error === "missing-password"
        ? "Vul een nieuw wachtwoord in (twee keer)."
        : sp.error === "mismatch"
          ? "De wachtwoorden komen niet overeen."
          : sp.error === "too-short"
            ? `Wachtwoord moet minimaal ${PASSWORD_MIN_LENGTH} tekens lang zijn.`
            : sp.error === "breached"
              ? "Dit wachtwoord komt voor in bekende datalekken. Kies een uniek wachtwoord."
              : sp.error === "wrong-totp"
                ? "2FA-code klopt niet. Wacht tot je app een nieuwe code toont."
                : sp.error === "too-many"
                  ? "Te veel pogingen — wacht enkele minuten en probeer opnieuw."
                  : null;

  return (
    <div className="mx-auto w-full max-w-md rounded-lg border border-burgundy/15 bg-white p-8 md:p-10">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Account herstel
      </p>
      <h1 className="mt-3 font-serif text-3xl text-ink-900 md:text-4xl">
        Nieuw wachtwoord
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-700">
        Voer je huidige 2FA-code (of een recovery code) in en kies een nieuw
        wachtwoord. Daarna log je opnieuw in.
      </p>

      <form action={submit} className="mt-8 space-y-4">
        <input type="hidden" name="token" value={token} />

        <label className="block">
          <span className="mb-1 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            2FA-code (of recovery code)
          </span>
          <input
            type="text"
            name="totp"
            inputMode="text"
            maxLength={16}
            required
            autoComplete="one-time-code"
            placeholder="123 456 of ABCD-EFGH-IJKL"
            className="w-full rounded border border-ink-200 bg-white px-4 py-3 font-mono text-base tracking-wider text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </label>

        <label className="block">
          <span className="mb-1 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Nieuw wachtwoord
          </span>
          <input
            type="password"
            name="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            className="w-full rounded border border-ink-200 bg-white px-4 py-3 font-mono text-base text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </label>

        <label className="block">
          <span className="mb-1 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Herhaal wachtwoord
          </span>
          <input
            type="password"
            name="confirm"
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            className="w-full rounded border border-ink-200 bg-white px-4 py-3 font-mono text-base text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </label>

        {errorMsg && (
          <p className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
            {errorMsg}
          </p>
        )}

        <button
          type="submit"
          className="w-full rounded-full bg-burgundy px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
        >
          Wachtwoord opslaan en inloggen
        </button>
      </form>

      <p className="mt-8 text-xs leading-relaxed text-ink-500">
        Na opslaan worden al je actieve sessies op andere apparaten beëindigd
        — een wachtwoordwijziging is een veiligheidsmoment.
      </p>
    </div>
  );
}
