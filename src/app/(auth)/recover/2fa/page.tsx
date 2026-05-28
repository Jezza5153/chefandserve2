/**
 * /recover/2fa?token=… — TOTP reset via recovery code + purpose-bound token.
 *
 * PR-C / Fence 5. Flow:
 *   1. Page loads → peekIntent(token, 'totp') → null ⇒ "link expired".
 *   2. Form: single recovery code (formaat ABCD-EFGH-IJKL).
 *   3. Submit → consumeRecoveryCode(userId, code) — atomic single-use.
 *      On miss → audit + redirect with error. The intent token is NOT
 *      consumed yet so the user can retry with another code.
 *   4. Recovery code good → consumeIntent (atomic single-use of the URL
 *      token). On miss → fail closed (race).
 *   5. UPDATE users SET totp_secret_encrypted=null, totp_enabled=false,
 *      totp_enrolled_at=null, permissions_version+=1, updated_at=now().
 *      DELETE all remaining recovery codes (the used set is now suspect).
 *   6. Audit auth.totp_recovery_used.
 *   7. Redirect to /login?reset=2fa with a banner explaining to log in
 *      via magic-link and re-enroll TOTP through the wizard.
 *
 * Note: we don't wipe the password — the user can still log in via magic
 * link OR password+TOTP (which won't work until they re-enroll, so
 * effectively magic-link only). After magic-link login the middleware
 * sees totp_enabled=false → bounces to /admin/account/setup/2fa.
 */

import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import { userRecoveryCodes, users } from "@/lib/db/schema";
import { checkRateLimit, extractClientIp } from "@/lib/rate-limit";
import { verifyAndConsume as consumeRecoveryCode } from "@/lib/recovery-codes";
import { consumeIntent, peekIntent } from "@/lib/recovery-intents";

export const metadata = {
  title: "2FA herstellen",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

async function submit(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const code = String(formData.get("code") ?? "").trim();

  if (!token) redirect("/login?error=recovery-invalid");
  if (!code) redirect(`/recover/2fa?token=${encodeURIComponent(token)}&error=missing-code`);

  const peeked = await peekIntent(token, "totp");
  if (!peeked) redirect("/login?error=recovery-invalid");

  const reqHeaders = await headers();
  const ip = extractClientIp(reqHeaders);

  // Rate-limit recovery-code attempts on this user. Same scope as TOTP
  // verify (5 per 5 min). Recovery codes are higher-value than TOTP so
  // sharing the scope is conservative.
  const gate = await checkRateLimit("totp_verify", peeked.userId);
  if (!gate.ok) {
    await recordAuditFromRequest({
      userId: peeked.userId,
      action: "auth.totp_rate_limited",
      resource: "users",
      resourceId: peeked.userId,
      after: { origin: "recover/2fa", retryAfterSec: gate.retryAfterSec },
    })
      .catch(() => {});
    redirect(`/recover/2fa?token=${encodeURIComponent(token)}&error=too-many`);
  }

  // Consume the recovery code first — if it's wrong/used, don't burn the
  // URL token so the user can try another code.
  const codeOk = await consumeRecoveryCode(peeked.userId, code);
  if (!codeOk) {
    await recordAuditFromRequest({
      userId: peeked.userId,
      action: "auth.recovery_code_failed",
      resource: "users",
      resourceId: peeked.userId,
      after: { origin: "recover/2fa", ip },
    })
      .catch(() => {});
    redirect(`/recover/2fa?token=${encodeURIComponent(token)}&error=wrong-code`);
  }

  // Recovery code accepted. Now atomically consume the URL token.
  const consumed = await consumeIntent(token, "totp");
  if (!consumed) {
    // Race: token consumed elsewhere. The recovery code is gone but the
    // user is no worse off — they still hold remaining codes (this attempt
    // just burned one). Surface the invalid-link page.
    redirect("/login?error=recovery-invalid");
  }

  // Wipe TOTP + remaining codes + bump permissions_version. The
  // permissions bump makes the bump-on-other-devices visible — anyone with
  // a stale JWT for this user gets kicked to /login on their next request.
  const [u] = await db
    .select({
      id: users.id,
      email: users.email,
      permissionsVersion: users.permissionsVersion,
    })
    .from(users)
    .where(eq(users.id, peeked.userId))
    .limit(1);
  if (!u) redirect("/login?error=recovery-invalid");

  await db
    .update(users)
    .set({
      totpSecretEncrypted: null,
      totpEnabled: false,
      totpEnrolledAt: null,
      permissionsVersion: u.permissionsVersion + 1,
      updatedAt: new Date(),
    })
    .where(eq(users.id, u.id));

  // Drop any remaining unused recovery codes — used set is now suspect.
  // (The freshly-consumed one was already flipped to used_at=now by
  // consumeRecoveryCode; deleting unused ones leaves the audit trail
  // intact on the used one.)
  await db
    .delete(userRecoveryCodes)
    .where(
      and(eq(userRecoveryCodes.userId, u.id), isNull(userRecoveryCodes.usedAt)),
    );

  await recordAuditFromRequest({
    userId: u.id,
    action: "auth.totp_recovery_used",
    resource: "users",
    resourceId: u.id,
    after: { emailMasked: maskEmail(u.email), ip },
  });

  redirect("/login?reset=2fa");
}

function maskEmail(e: string): string {
  const [local, domain] = e.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

export default async function Recover2FAPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const token = (sp.token ?? "").trim();

  if (!token) {
    redirect("/login/lost-2fa");
  }

  const peeked = await peekIntent(token, "totp");
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
          aan via de 2FA-herstelflow.
        </p>
        <p className="mt-6 text-xs text-ink-500">
          <Link
            href="/login/lost-2fa"
            className="text-burgundy underline-offset-4 hover:underline"
          >
            ← Nieuwe herstellink aanvragen
          </Link>
        </p>
      </div>
    );
  }

  const errorMsg =
    sp.error === "missing-code"
      ? "Vul een recovery code in."
      : sp.error === "wrong-code"
        ? "Code niet herkend of al gebruikt. Probeer een andere recovery code."
        : sp.error === "too-many"
          ? "Te veel pogingen — wacht enkele minuten en probeer opnieuw."
          : null;

  return (
    <div className="mx-auto w-full max-w-md rounded-lg border border-burgundy/15 bg-white p-8 md:p-10">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Account herstel
      </p>
      <h1 className="mt-3 font-serif text-3xl text-ink-900 md:text-4xl">
        2FA herstellen
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-700">
        Voer één van je recovery codes in. Daarna wordt je 2FA-instelling
        gewist en richt je via de setup-wizard opnieuw een authenticator-app
        in.
      </p>

      <form action={submit} className="mt-8 space-y-4">
        <input type="hidden" name="token" value={token} />

        <label className="block">
          <span className="mb-1 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Recovery code
          </span>
          <input
            type="text"
            name="code"
            inputMode="text"
            maxLength={16}
            required
            autoComplete="off"
            placeholder="ABCD-EFGH-IJKL"
            autoFocus
            className="w-full rounded border border-ink-200 bg-white px-4 py-3 font-mono text-base tracking-wider text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
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
          2FA resetten
        </button>
      </form>

      <p className="mt-8 text-xs leading-relaxed text-ink-500">
        Na het herstellen log je opnieuw in via een eenmalige inloglink
        (magic-link). Tijdens je eerste login wordt je naar de setup-wizard
        gestuurd om opnieuw een authenticator in te stellen.
      </p>
    </div>
  );
}
