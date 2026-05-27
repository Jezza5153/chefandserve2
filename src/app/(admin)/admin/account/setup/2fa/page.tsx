/**
 * Setup step 2 — scan TOTP QR + verify code.
 *
 * Mirrors the standalone /admin/account/2fa enrollment flow but wraps it
 * in the wizard chrome, then redirects to the recovery-codes step on
 * success instead of the codes route.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { auditLog, users } from "@/lib/db/schema";
import { requireAuth } from "@/lib/permissions";
import { generateAndPersist } from "@/lib/recovery-codes";
import {
  buildProvisioningUri,
  buildQrDataUrl,
  encryptSecret,
  generateSecret,
  verifyCode,
} from "@/lib/totp";

import { WizardShell } from "../_components/WizardShell";

export const metadata = {
  title: "Activeer twee-factor authenticatie",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const SETUP_COOKIE = "cs_2fa_setup";
const CODES_COOKIE = "cs_2fa_codes";
const SETUP_TTL = 10 * 60;
const CODES_TTL = 5 * 60;

async function confirm2FA(formData: FormData) {
  "use server";
  const session = await requireAuth("/admin/account/setup");
  const code = String(formData.get("code") ?? "").trim();
  const cookieStore = await cookies();
  const setupSecret = cookieStore.get(SETUP_COOKIE)?.value;

  if (!setupSecret) {
    redirect("/admin/account/setup/2fa?error=session-expired");
  }
  if (!code) {
    redirect("/admin/account/setup/2fa?error=missing-code");
  }
  if (!verifyCode(setupSecret, code)) {
    redirect("/admin/account/setup/2fa?error=wrong-code");
  }

  const encrypted = encryptSecret(setupSecret);

  const [current] = await db
    .select({ permissionsVersion: users.permissionsVersion })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  await db
    .update(users)
    .set({
      totpSecretEncrypted: encrypted,
      totpEnabled: true,
      totpEnrolledAt: new Date(),
      permissionsVersion: (current?.permissionsVersion ?? 1) + 1,
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.user.id));

  const recoveryCodes = await generateAndPersist(session.user.id);

  await db.insert(auditLog).values({
    userId: session.user.id,
    action: "auth.totp_enrolled",
    resource: "users",
    resourceId: session.user.id,
    after: { via: "setup-wizard", codesGenerated: recoveryCodes.length },
  });

  cookieStore.set(CODES_COOKIE, JSON.stringify(recoveryCodes), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: CODES_TTL,
    path: "/admin/account/setup",
  });
  cookieStore.delete(SETUP_COOKIE);

  redirect("/admin/account/setup/codes");
}

export default async function Setup2FAPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireAuth("/admin/account/setup");
  const params = await searchParams;

  // Guard: password must already be set.
  const [u] = await db
    .select({
      passwordHash: users.passwordHash,
      totpEnabled: users.totpEnabled,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!u) redirect("/login");
  if (!u.passwordHash) redirect("/admin/account/setup/password");
  if (u.totpEnabled) redirect("/admin/account/setup");

  // Generate fresh secret per render; store in a short-lived cookie so the
  // confirm action can read it back without trusting form-data.
  const secret = generateSecret();
  const uri = buildProvisioningUri({
    secretBase32: secret,
    accountEmail: session.user.email,
  });
  const qr = await buildQrDataUrl(uri);

  (await cookies()).set(SETUP_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SETUP_TTL,
    path: "/admin/account/setup",
  });

  const errorMsg =
    params.error === "session-expired"
      ? "Setup is verlopen — scan de QR-code opnieuw."
      : params.error === "wrong-code"
        ? "Onjuiste code. Wacht tot je app de volgende code toont en probeer opnieuw."
        : params.error === "missing-code"
          ? "Vul de 6-cijferige code in."
          : null;

  return (
    <WizardShell current={2}>
      <h1 className="font-serif text-4xl text-ink-900 md:text-5xl">
        Activeer twee-factor authenticatie
      </h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700 md:text-base">
        Gebruik een authenticator-app — 1Password, Authy, Google Authenticator
        of Bitwarden. Scan de QR-code, voer de 6-cijferige code in, klaar.
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-[240px_1fr]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qr}
          alt="QR-code voor authenticator-app"
          width={240}
          height={240}
          className="rounded border border-ink-200 bg-white p-2"
        />
        <div>
          <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Lukt scannen niet?
          </p>
          <p className="mt-2 text-xs text-ink-700">
            Voer deze sleutel handmatig in als &ldquo;Time-based&rdquo;:
          </p>
          <pre className="mt-2 rounded bg-bg-gray p-3 font-mono text-xs leading-relaxed text-ink-900 break-all">
            {secret.match(/.{1,4}/g)?.join(" ")}
          </pre>
        </div>
      </div>

      <form action={confirm2FA} className="mt-8 space-y-4">
        <label className="block">
          <span className="mb-2 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            6-cijferige code
          </span>
          <input
            type="text"
            name="code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="123 456"
            required
            autoFocus
            autoComplete="one-time-code"
            className="w-full max-w-xs rounded border border-ink-200 bg-white px-4 py-3 font-mono text-lg tracking-[0.4em] text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </label>

        {errorMsg ? (
          <p className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
            {errorMsg}
          </p>
        ) : null}

        <button
          type="submit"
          className="rounded-full bg-burgundy px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
        >
          Bevestig en activeer
        </button>
      </form>
    </WizardShell>
  );
}
