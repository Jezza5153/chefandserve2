/**
 * /verify-2fa — second-factor challenge.
 *
 * PR-S2B. Reached only when:
 *   - TOTP_ENFORCE=true
 *   - User is internal (kind=internal)
 *   - User has totp_enabled=true
 *   - No valid cs_2fa_verified cookie (or it expired)
 *
 * Submits either a TOTP code or a recovery code. On success: mint the
 * signed verification cookie + redirect to the originally-requested URL
 * (taken from ?next= which middleware sets when bouncing the user here).
 *
 * Rate-limit: 5 attempts per user per 5 minutes (totp_verify scope from
 * PR-S1A). Failures audit-logged.
 */

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { auditLog, users } from "@/lib/db/schema";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyAndConsume } from "@/lib/recovery-codes";
import { buildCookieValue, TWOFA_COOKIE_NAME } from "@/lib/totp-cookie";
import { decryptSecret, verifyCode } from "@/lib/totp";

export const metadata = { title: "Bevestig je code" };
export const dynamic = "force-dynamic";

async function submit(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const raw = String(formData.get("code") ?? "").trim();
  const next = sanitizeNext(String(formData.get("next") ?? ""));

  if (!raw) {
    redirect(`/verify-2fa?error=missing-code&next=${encodeURIComponent(next)}`);
  }

  // Rate-limit attempts per user.
  const gate = await checkRateLimit("totp_verify", session.user.id);
  if (!gate.ok) {
    await db
      .insert(auditLog)
      .values({
        userId: session.user.id,
        action: "auth.totp_rate_limited",
        resource: "users",
        resourceId: session.user.id,
        after: { retryAfterSec: gate.retryAfterSec },
      })
      .catch(() => {});
    redirect(`/verify-2fa?error=too-many&next=${encodeURIComponent(next)}`);
  }

  const [u] = await db
    .select({
      id: users.id,
      totpEnabled: users.totpEnabled,
      totpSecretEncrypted: users.totpSecretEncrypted,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!u?.totpEnabled || !u.totpSecretEncrypted) {
    // Shouldn't happen — middleware wouldn't have sent us here. Bypass.
    redirect(next || "/admin");
  }

  // Try TOTP first; fall through to recovery code on miss.
  let ok = false;
  let factorType: "totp" | "recovery" = "totp";

  const cleaned = raw.replace(/\s+/g, "");
  if (/^\d{6}$/.test(cleaned)) {
    try {
      const secret = await decryptSecret(u.totpSecretEncrypted);
      ok = verifyCode(secret, cleaned);
    } catch {
      ok = false;
    }
  }

  if (!ok) {
    ok = await verifyAndConsume(u.id, raw);
    factorType = "recovery";
  }

  if (!ok) {
    await db
      .insert(auditLog)
      .values({
        userId: u.id,
        action: "auth.totp_verify_failed",
        resource: "users",
        resourceId: u.id,
      })
      .catch(() => {});
    redirect(`/verify-2fa?error=wrong-code&next=${encodeURIComponent(next)}`);
  }

  // Success — mint the 2FA cookie.
  const cookie = await buildCookieValue(u.id);
  (await cookies()).set(TWOFA_COOKIE_NAME, cookie.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: cookie.maxAge,
    path: "/",
  });

  await db.insert(auditLog).values({
    userId: u.id,
    action: "auth.totp_verified",
    resource: "users",
    resourceId: u.id,
    after: { factorType },
  });

  redirect(next || "/admin");
}

function sanitizeNext(input: string): string {
  // Only allow same-origin paths; block protocol-relative URLs.
  if (input.startsWith("/") && !input.startsWith("//")) return input;
  return "/admin";
}

export default async function Verify2FAPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  // Suppress lint for headers() being unused — keep the import for parity
  // with the action's ip-derivation pattern when we extend in S2C.
  void (await headers());

  const next = sanitizeNext(params.next ?? "");

  const errorMsg =
    params.error === "wrong-code"
      ? "Code niet herkend. Probeer je huidige 6-cijferige code of een recovery code."
      : params.error === "missing-code"
        ? "Vul een code in."
        : params.error === "too-many"
          ? "Te veel pogingen — probeer het over enkele minuten opnieuw."
          : null;

  return (
    <div className="mx-auto w-full max-w-md rounded-lg border border-burgundy/15 bg-white p-8 md:p-10">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Bevestig je code
      </p>
      <h1 className="mt-3 font-serif text-3xl text-ink-900 md:text-4xl">
        Twee-factor authenticatie
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-700">
        Voer de 6-cijferige code uit je authenticator-app in. Geen toegang
        tot je telefoon? Gebruik een recovery code (formaat <code>ABCD-EFGH-IJKL</code>).
      </p>

      <form action={submit} className="mt-8 space-y-4">
        <input type="hidden" name="next" value={next} />
        <input
          type="text"
          name="code"
          placeholder="123456 of ABCD-EFGH-IJKL"
          required
          autoFocus
          autoComplete="one-time-code"
          className="w-full rounded border border-ink-200 bg-white px-4 py-3 font-mono text-base tracking-wider text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
        />

        {errorMsg ? (
          <p className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
            {errorMsg}
          </p>
        ) : null}

        <button
          type="submit"
          className="w-full rounded-full bg-burgundy px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
        >
          Bevestig
        </button>
      </form>
    </div>
  );
}
