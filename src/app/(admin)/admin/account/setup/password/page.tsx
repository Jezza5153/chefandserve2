/**
 * Setup step 1 — set password.
 *
 * Policy: minimum 12 characters, no other rules. Breach-check via HIBP
 * k-anonymity API (fail-open on network errors). bcrypt hashed.
 *
 * After save → bumps permissionsVersion → redirects to /admin/account/setup
 * which routes forward to step 2 (TOTP).
 */

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { auditLog, users } from "@/lib/db/schema";
import {
  hashPassword,
  PASSWORD_MIN_LENGTH,
  validatePassword,
} from "@/lib/passwords";
import { requireAuth } from "@/lib/permissions";

import { WizardShell } from "../_components/WizardShell";

export const metadata = { title: "Stel een wachtwoord in", robots: { index: false } };
export const dynamic = "force-dynamic";

async function setPassword(formData: FormData) {
  "use server";
  const session = await requireAuth("/admin/account/setup");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password !== confirm) {
    redirect("/admin/account/setup/password?error=mismatch");
  }

  const result = await validatePassword(password);
  if (!result.ok) {
    const errKey =
      result.reason === "too-short"
        ? "too-short"
        : result.reason === "breached"
          ? "breached"
          : "empty";
    redirect(`/admin/account/setup/password?error=${errKey}`);
  }

  const hash = await hashPassword(password);

  // NOTE: do NOT bump permissionsVersion here. The user is changing their
  // own password mid-wizard — bumping would invalidate their current JWT
  // and kick them back to /login (the JWT callback returns null on
  // version mismatch). The password isn't checked per-request anyway, so
  // there's nothing to invalidate.
  await db
    .update(users)
    .set({
      passwordHash: hash,
      passwordSetAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.user.id));

  await db.insert(auditLog).values({
    userId: session.user.id,
    action: "auth.password_set",
    resource: "users",
    resourceId: session.user.id,
  });

  redirect("/admin/account/setup");
}

export default async function SetupPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAuth("/admin/account/setup");
  const params = await searchParams;

  const errorMsg =
    params.error === "mismatch"
      ? "De wachtwoorden komen niet overeen."
      : params.error === "too-short"
        ? `Wachtwoord moet minimaal ${PASSWORD_MIN_LENGTH} tekens lang zijn.`
        : params.error === "breached"
          ? "Dit wachtwoord komt voor in bekende datalekken. Kies een uniek wachtwoord (een wachtzin werkt goed)."
          : params.error === "empty"
            ? "Vul een wachtwoord in."
            : null;

  return (
    <WizardShell current={1}>
      <h1 className="font-serif text-4xl text-ink-900 md:text-5xl">
        Stel een wachtwoord in
      </h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700 md:text-base">
        Voor je interne account heb je een wachtwoord nodig. Minstens{" "}
        <strong>{PASSWORD_MIN_LENGTH} tekens</strong>, geen andere regels —
        een herkenbare zin met vier of meer woorden is veiliger dan iets
        met speciale tekens. We controleren je wachtwoord tegen bekende
        datalekken zonder het ooit te versturen (alleen een hash-prefix).
      </p>

      <form action={setPassword} className="mt-10 space-y-5">
        <label className="block">
          <span className="mb-2 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Nieuw wachtwoord
          </span>
          <input
            type="password"
            name="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            autoFocus
            className="w-full rounded border border-ink-200 bg-white px-4 py-3 font-mono text-base text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </label>

        <label className="block">
          <span className="mb-2 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Herhaal wachtwoord
          </span>
          <input
            type="password"
            name="confirm"
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            className="w-full rounded border border-ink-200 bg-white px-4 py-3 font-mono text-base text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
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
          Wachtwoord opslaan
        </button>
      </form>

      <p className="mt-10 text-xs leading-relaxed text-ink-500">
        Wij slaan je wachtwoord op als een bcrypt-hash (cost 12). Je kunt het
        op elk moment wijzigen via je accountinstellingen.
      </p>
    </WizardShell>
  );
}
