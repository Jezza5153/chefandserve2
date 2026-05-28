/**
 * Disable 2FA — requires a valid current factor.
 *
 * Either:
 *   - the current 6-digit TOTP code, OR
 *   - a recovery code
 *
 * On success: wipe totp_secret_encrypted + recovery codes, set
 * totp_enabled=false, bump permissionsVersion, audit.
 */

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import { users } from "@/lib/db/schema";
import { requireRole } from "@/lib/permissions";
import { clearAll, verifyAndConsume } from "@/lib/recovery-codes";
import { decryptSecret, verifyCode } from "@/lib/totp";

export const metadata = { title: "2FA uitschakelen" };
export const dynamic = "force-dynamic";

async function disable2FA(formData: FormData) {
  "use server";
  const session = await requireRole("owner");
  const raw = String(formData.get("factor") ?? "").trim();

  if (!raw) {
    redirect("/admin/account/2fa/disable?error=missing-factor");
  }

  const [u] = await db
    .select({
      id: users.id,
      totpEnabled: users.totpEnabled,
      totpSecretEncrypted: users.totpSecretEncrypted,
      permissionsVersion: users.permissionsVersion,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!u || !u.totpEnabled || !u.totpSecretEncrypted) {
    // Already off — nothing to do.
    redirect("/admin/account/2fa");
  }

  // Try TOTP first (likely 6-digit numeric).
  const looksLikeTotp = /^\d{6}$/.test(raw.replace(/\s+/g, ""));
  let factorOk = false;
  let factorType: "totp" | "recovery" = "totp";

  if (looksLikeTotp) {
    try {
      const secret = await decryptSecret(u.totpSecretEncrypted);
      factorOk = verifyCode(secret, raw);
    } catch {
      factorOk = false;
    }
  }

  if (!factorOk) {
    // Try recovery code instead (consumes if matched).
    factorOk = await verifyAndConsume(u.id, raw);
    factorType = "recovery";
  }

  if (!factorOk) {
    await recordAuditFromRequest({
      userId: u.id,
      action: "auth.totp_disable_rejected",
      resource: "users",
      resourceId: u.id,
      after: { reason: "wrong-factor" },
    })
      .catch(() => {});
    redirect("/admin/account/2fa/disable?error=wrong-factor");
  }

  // Wipe + flip the flag + bump permissionsVersion.
  await db
    .update(users)
    .set({
      totpSecretEncrypted: null,
      totpEnabled: false,
      totpEnrolledAt: null,
      // No permissionsVersion bump — self-action. Other-device 2FA cookies
      // expire on their own TTL; if you need to nuke them after a disable,
      // it's a separate admin tool.
      updatedAt: new Date(),
    })
    .where(eq(users.id, u.id));

  await clearAll(u.id);

  await recordAuditFromRequest({
    userId: u.id,
    action: "auth.totp_disabled",
    resource: "users",
    resourceId: u.id,
    after: { factorType },
  });

  redirect("/admin/account/2fa?disabled=1");
}

export default async function Disable2FAPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireRole("owner");
  const params = await searchParams;

  const [u] = await db
    .select({ totpEnabled: users.totpEnabled })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!u?.totpEnabled) {
    redirect("/admin/account/2fa");
  }

  const errorMsg =
    params.error === "wrong-factor"
      ? "Code niet herkend. Probeer je huidige 6-cijferige code of een recovery code."
      : params.error === "missing-factor"
        ? "Vul je code in."
        : null;

  return (
    <div className="mx-auto max-w-2xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Account · 2FA uitschakelen
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        Weet je het zeker?
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-700 md:text-base">
        Zonder 2FA is je account alleen beschermd door magic-link en
        rate-limiting. Voor interne accounts wordt 2FA verplicht zodra de
        challenge-gate live gaat.
      </p>

      <form action={disable2FA} className="mt-10 space-y-4">
        <label className="block">
          <span className="mb-2 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Huidige 2FA-code of recovery code
          </span>
          <input
            type="text"
            name="factor"
            placeholder="123456 of ABCD-EFGH-IJKL"
            required
            autoFocus
            autoComplete="one-time-code"
            className="w-full max-w-md rounded border border-ink-200 bg-white px-4 py-3 font-mono text-base tracking-wider text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </label>

        {errorMsg ? (
          <p className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
            {errorMsg}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3 pt-4">
          <button
            type="submit"
            className="rounded-full bg-burgundy px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
          >
            2FA uitschakelen
          </button>
          <a
            href="/admin/account/2fa"
            className="rounded-full border border-ink-200 bg-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-700 transition-colors hover:bg-bg-gray"
          >
            Annuleren
          </a>
        </div>
      </form>
    </div>
  );
}
