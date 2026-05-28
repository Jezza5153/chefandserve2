/**
 * /admin/system/users/new — invite a new internal staff member.
 *
 * PR-A. Super_admin only. Owners do not access /admin/system/users/* at all
 * in V1 (existing role gate at the middleware level).
 *
 * Form fields: name, email, role (owner / super_admin).
 * Server action calls inviteInternalStaff() — creates user + role link,
 * sends invite email. New user lands on /login → forced setup wizard
 * → operational dashboard.
 */

import { redirect } from "next/navigation";
import Link from "next/link";

import { recordAuditFromRequest } from "@/lib/audit";

import { inviteInternalStaff } from "@/lib/domain/portal-invites";
import { requireRole } from "@/lib/permissions";

export const metadata = {
  title: "Nieuwe medewerker uitnodigen",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

async function inviteStaff(formData: FormData) {
  "use server";
  // Server-side authority check (NOT just dropdown hiding).
  const session = await requireRole("super_admin", "/admin/system/users/new", {
    strict: true,
  });

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "");

  if (role !== "owner" && role !== "super_admin") {
    await recordAuditFromRequest({
      userId: session.user.id,
      action: "auth.invite_rejected",
      resource: "users",
      after: { reason: "invalid-role", role },
    })
      .catch(() => {});
    redirect("/admin/system/users/new?error=invalid-role");
  }

  const result = await inviteInternalStaff({
    email,
    name,
    role,
    actingUserId: session.user.id,
  });

  if (!result.ok) {
    redirect(
      `/admin/system/users/new?error=${encodeURIComponent(result.error)}`,
    );
  }

  redirect(
    `/admin/system/users?invited=${encodeURIComponent(email)}${
      result.alreadyExisted ? "&existing=1" : ""
    }`,
  );
}

export default async function NewUserPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireRole("super_admin", "/admin/system/users/new", { strict: true });
  const params = await searchParams;

  const errorMsg = params.error
    ? decodeURIComponent(params.error)
    : null;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link
          href="/admin/system/users"
          className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          ← Terug naar gebruikers
        </Link>
      </div>

      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        System · users
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        Nodig een medewerker uit
      </h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700 md:text-base">
        Voeg een interne medewerker toe (super_admin of owner). Ze krijgen
        meteen een uitnodigingsmail. Bij hun eerste login worden ze
        verplicht door de wizard om een wachtwoord en 2FA in te stellen
        voordat ze het dashboard kunnen zien.
      </p>

      <form action={inviteStaff} className="mt-10 space-y-5">
        <label className="block">
          <span className="mb-1 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Volledige naam
          </span>
          <input
            type="text"
            name="name"
            required
            autoFocus
            placeholder="bijv. Maarten Hogeveen"
            className="w-full rounded border border-ink-200 bg-white px-4 py-3 text-base text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </label>

        <label className="block">
          <span className="mb-1 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            E-mailadres
          </span>
          <input
            type="email"
            name="email"
            required
            autoComplete="off"
            placeholder="bijv. maarten@chefandserve.nl"
            className="w-full rounded border border-ink-200 bg-white px-4 py-3 text-base text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
        </label>

        <label className="block">
          <span className="mb-1 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Rol
          </span>
          <select
            name="role"
            required
            defaultValue=""
            className="w-full rounded border border-ink-200 bg-white px-4 py-3 text-base text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          >
            <option value="" disabled>
              Kies een rol…
            </option>
            <option value="owner">Owner — operations toegang</option>
            <option value="super_admin">
              Super_admin — volledige toegang inclusief systeem-pagina&apos;s
            </option>
          </select>
          <p className="mt-2 text-xs text-ink-500">
            Owners zien chefs, klanten, shifts. Super_admins zien daarnaast
            ook errors, audit log, gebruikersbeheer en 2FA-resets.
          </p>
        </label>

        {errorMsg && (
          <p className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">
            ⚠ {errorMsg}
          </p>
        )}

        <div className="flex flex-wrap gap-3 pt-4">
          <button
            type="submit"
            className="rounded-full bg-burgundy px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
          >
            Verstuur uitnodiging
          </button>
          <Link
            href="/admin/system/users"
            className="rounded-full border border-ink-200 bg-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-700 transition-colors hover:bg-bg-gray"
          >
            Annuleren
          </Link>
        </div>
      </form>

      <p className="mt-10 text-xs leading-relaxed text-ink-500">
        De uitnodigingsmail bevat een link naar <code>/login</code>. Ze
        loggen in met hun e-mail, krijgen een eenmalige magic-link en
        worden dan door de setup-wizard geleid (wachtwoord + 2FA +
        recovery codes — ~90 seconden).
      </p>
    </div>
  );
}
