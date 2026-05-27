/**
 * /admin/account/2fa — TOTP enrollment surface.
 *
 * PR-S2A: enrollment only. No challenge-on-login yet.
 *
 * Flow:
 *   1. Not enrolled → render QR + verify form. Pending secret kept in a
 *      short-lived HttpOnly cookie (cs_2fa_setup, 10-min TTL).
 *   2. Verify success → encrypt secret, persist, generate 8 recovery codes,
 *      stash codes in cs_2fa_codes cookie (5-min TTL), redirect to /codes
 *      page where codes are shown one time.
 *   3. Already enrolled → show status + Disable link.
 *
 * Access: super_admin + owner (any "internal" user). The requireRole helper
 * lets super_admin through the owner gate.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { auditLog, users } from "@/lib/db/schema";
import { requireRole } from "@/lib/permissions";
import { countUnused, generateAndPersist } from "@/lib/recovery-codes";
import {
  buildProvisioningUri,
  buildQrDataUrl,
  encryptSecret,
  generateSecret,
  verifyCode,
} from "@/lib/totp";

export const metadata = { title: "2FA — Twee-factor authenticatie" };
export const dynamic = "force-dynamic";

const SETUP_COOKIE = "cs_2fa_setup";
const CODES_COOKIE = "cs_2fa_codes";
const SETUP_TTL = 10 * 60;
const CODES_TTL = 5 * 60;

/* -------- server action --------------------------------------------- */

async function confirmEnrollment(formData: FormData) {
  "use server";
  const session = await requireRole("owner");
  const code = String(formData.get("code") ?? "").trim();

  const cookieStore = await cookies();
  const setupSecret = cookieStore.get(SETUP_COOKIE)?.value;
  if (!setupSecret) {
    redirect("/admin/account/2fa?error=session-expired");
  }
  if (!code) {
    redirect("/admin/account/2fa?error=missing-code");
  }

  if (!verifyCode(setupSecret, code)) {
    redirect("/admin/account/2fa?error=wrong-code");
  }

  // Verified. Encrypt + persist + generate recovery codes.
  const encrypted = encryptSecret(setupSecret);
  await db
    .update(users)
    .set({
      totpSecretEncrypted: encrypted,
      totpEnabled: true,
      totpEnrolledAt: new Date(),
      // bump permissionsVersion so other devices/tabs re-validate the session
      permissionsVersion: (await currentPermissionsVersion(session.user.id)) + 1,
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.user.id));

  const recoveryCodes = await generateAndPersist(session.user.id);

  await db.insert(auditLog).values({
    userId: session.user.id,
    action: "auth.totp_enrolled",
    resource: "users",
    resourceId: session.user.id,
    after: { codesGenerated: recoveryCodes.length },
  });

  // Stash codes in a one-time cookie for the /codes page to display.
  cookieStore.set(CODES_COOKIE, JSON.stringify(recoveryCodes), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: CODES_TTL,
    path: "/admin/account/2fa",
  });
  // Clear the setup-secret cookie immediately.
  cookieStore.delete(SETUP_COOKIE);

  redirect("/admin/account/2fa/codes");
}

async function currentPermissionsVersion(userId: string): Promise<number> {
  const [u] = await db
    .select({ v: users.permissionsVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u?.v ?? 1;
}

/* -------- page ------------------------------------------------------ */

export default async function TwoFAPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireRole("owner");
  const params = await searchParams;

  const [userRow] = await db
    .select({
      totpEnabled: users.totpEnabled,
      totpEnrolledAt: users.totpEnrolledAt,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!userRow) redirect("/admin");

  /* ----- already enrolled ----- */
  if (userRow.totpEnabled) {
    const codesLeft = await countUnused(session.user.id);
    return (
      <div className="mx-auto max-w-2xl">
        <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Account · 2FA
        </p>
        <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
          Twee-factor authenticatie is actief
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-700 md:text-base">
          Je account is beveiligd met TOTP. Bij toekomstige logins (zodra de
          challenge-gate live gaat) heb je je authenticator nodig.
        </p>

        <div className="mt-10 rounded-lg border border-ink-200 bg-white p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
                Geactiveerd op
              </p>
              <p className="mt-1 text-sm text-ink-900">
                {userRow.totpEnrolledAt
                  ? new Date(userRow.totpEnrolledAt).toLocaleString("nl-NL")
                  : "—"}
              </p>
            </div>
            <div>
              <p className="font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
                Recovery codes resterend
              </p>
              <p className="mt-1 text-sm text-ink-900">{codesLeft} van 8</p>
            </div>
          </div>
        </div>

        <p className="mt-10 text-xs text-ink-500">
          Wil je 2FA uitschakelen? Dat kan via{" "}
          <a
            href="/admin/account/2fa/disable"
            className="text-burgundy hover:underline"
          >
            de disable-pagina
          </a>{" "}
          — vereist je huidige code of een recovery code.
        </p>
      </div>
    );
  }

  /* ----- not yet enrolled — render setup UI ----- */

  const secret = generateSecret();
  const uri = buildProvisioningUri({
    secretBase32: secret,
    accountEmail: session.user.email!,
  });
  const qr = await buildQrDataUrl(uri);

  // Set the cookie so the verify form server-action can read it back.
  (await cookies()).set(SETUP_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SETUP_TTL,
    path: "/admin/account/2fa",
  });

  const errorMsg =
    params.error === "session-expired"
      ? "Setup is verlopen — scan de QR-code opnieuw en probeer het binnen 10 minuten."
      : params.error === "wrong-code"
        ? "Onjuiste code. Wacht ~30 seconden tot de volgende code en probeer opnieuw."
        : params.error === "missing-code"
          ? "Vul de 6-cijferige code in."
          : null;

  return (
    <div className="mx-auto max-w-2xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Account · 2FA setup
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        Zet twee-factor authenticatie aan
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-700 md:text-base">
        Voor interne accounts vereist Chef &amp; Serve TOTP. Gebruik een
        authenticator-app zoals 1Password, Authy of Google Authenticator.
      </p>

      <ol className="mt-10 space-y-8">
        <li>
          <div className="flex items-baseline gap-3">
            <span className="font-serif text-2xl text-burgundy">1</span>
            <h2 className="font-serif text-xl text-ink-900">
              Scan deze QR-code met je authenticator
            </h2>
          </div>
          <div className="mt-4 grid gap-6 sm:grid-cols-[240px_1fr]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qr}
              alt="QR-code voor authenticator-app"
              width={240}
              height={240}
              className="rounded border border-ink-200 bg-white p-2"
            />
            <div>
              <p className="text-xs text-ink-500">
                Lukt scannen niet? Voer deze sleutel handmatig in (Type:
                Time-based):
              </p>
              <pre className="mt-2 rounded bg-bg-gray p-3 font-mono text-xs leading-relaxed text-ink-900 break-all">
                {secret.match(/.{1,4}/g)?.join(" ")}
              </pre>
            </div>
          </div>
        </li>

        <li>
          <div className="flex items-baseline gap-3">
            <span className="font-serif text-2xl text-burgundy">2</span>
            <h2 className="font-serif text-xl text-ink-900">
              Voer de 6-cijferige code in
            </h2>
          </div>
          <form action={confirmEnrollment} className="mt-4 space-y-4">
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
        </li>
      </ol>

      <p className="mt-10 text-xs leading-relaxed text-ink-500">
        Direct na bevestiging krijg je 8 eenmalige recovery codes. Bewaar ze
        op een veilige plek — ze zijn de enige manier om in te loggen als je
        je telefoon verliest.
      </p>
    </div>
  );
}
