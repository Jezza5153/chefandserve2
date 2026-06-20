/**
 * /chef/privacy — chef files an AVG data-subject request (PR-AVG-1).
 * Portal channel → identity is verified by the logged-in session.
 */

import { redirect } from "next/navigation";

import { fieldClass } from "@/components/forms/Fields";
import { createPrivacyRequest } from "@/lib/domain/privacy";
import { getI18n } from "@/lib/i18n/server";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Privacyverzoek", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Request-type enum values (server-validated); labels come from the dict. */
const TYPE_VALUES = ["access", "export", "correction", "deletion", "other"] as const;

async function submit(formData: FormData) {
  "use server";
  const session = await requireAuth();
  const type = String(formData.get("type") ?? "access") as
    | "access" | "export" | "correction" | "deletion" | "other";
  const reason = String(formData.get("reason") ?? "").trim() || null;
  await createPrivacyRequest({
    userId: session.user.id,
    type,
    reason,
    requesterKind: "chef",
    originalChannel: "portal",
    identityStatus: "verified", // logged-in session = identity established
    actorId: session.user.id,
  });
  redirect("/chef/privacy?ok=1");
}

export default async function ChefPrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  await requireAuth("/chef/privacy");
  const { dict: t } = await getI18n();
  const sp = await searchParams;

  return (
    <div className="mx-auto max-w-xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        {t.privacy.eyebrow}
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">{t.privacy.title}</h1>
      <p className="mt-2 text-sm text-ink-500">{t.privacy.intro}</p>

      {sp.ok ? (
        <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {t.privacy.ok}
        </p>
      ) : null}

      <form action={submit} className="mt-6 space-y-4">
        <label className="block">
          <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            {t.privacy.whatLabel}
          </span>
          <select
            name="type"
            className={fieldClass}
          >
            {TYPE_VALUES.map((v) => (
              <option key={v} value={v}>{t.privacy.types[v]}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            {t.privacy.noteLabel}
          </span>
          <textarea
            name="reason"
            rows={4}
            placeholder={t.privacy.notePlaceholder}
            className={`${fieldClass} placeholder-ink-500`}
          />
        </label>
        <button
          type="submit"
          className="rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
        >
          {t.privacy.submit}
        </button>
      </form>
    </div>
  );
}
