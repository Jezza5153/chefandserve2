/**
 * /client/privacy — klant contact files an AVG data-subject request (PR-AVG-1).
 * Portal channel → identity verified by the logged-in session.
 */

import { redirect } from "next/navigation";

import { fieldClass } from "@/components/forms/Fields";
import { ClientDataOverview } from "@/components/privacy/ClientDataOverview";
import { CLIENT_ONBOARDING_FORM_SLUG, getClientByUserId, hydrateFormState } from "@/lib/domain/client-onboarding";
import { getPublishedForm } from "@/lib/domain/forms";
import { createPrivacyRequest } from "@/lib/domain/privacy";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Privacyverzoek", robots: { index: false } };
export const dynamic = "force-dynamic";

const TYPE_OPTIONS = [
  { value: "access", label: "Inzage — welke gegevens hebben jullie van mij?" },
  { value: "export", label: "Export — een kopie van mijn gegevens" },
  { value: "correction", label: "Correctie — gegevens kloppen niet" },
  { value: "deletion", label: "Verwijdering — verwijder mijn gegevens" },
  { value: "other", label: "Anders / overig" },
];

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
    requesterKind: "klant",
    originalChannel: "portal",
    identityStatus: "verified",
    actorId: session.user.id,
  });
  redirect("/client/privacy?ok=1");
}

export default async function ClientPrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const session = await requireAuth("/client/privacy");
  const sp = await searchParams;

  // AVG transparency: load the klant's own data so we can show exactly what we hold.
  const client = await getClientByUserId(session.user.id);
  const form = client ? await getPublishedForm(CLIENT_ONBOARDING_FORM_SLUG) : null;
  const overviewInitial = client && form ? await hydrateFormState(form, client) : null;

  return (
    <div className="mx-auto max-w-xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Privacy
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Privacyverzoek indienen</h1>
      <p className="mt-2 text-sm text-ink-500">
        Op grond van de AVG kun je inzage, een kopie, correctie of verwijdering
        van je persoonsgegevens vragen. We reageren binnen 30 dagen. Let op:
        sommige administratiegegevens moeten we wettelijk bewaren.
      </p>

      {sp.ok ? (
        <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          ✓ Je verzoek is ontvangen. We reageren binnen 30 dagen.
        </p>
      ) : null}

      <form action={submit} className="mt-6 space-y-4">
        <label className="block">
          <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Wat wil je?
          </span>
          <select
            name="type"
            className={fieldClass}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Toelichting (optioneel)
          </span>
          <textarea
            name="reason"
            rows={4}
            placeholder="Bijv. welke gegevens het betreft."
            className={`${fieldClass} placeholder-ink-500`}
          />
        </label>
        <button
          type="submit"
          className="rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
        >
          Verzoek indienen
        </button>
      </form>

      {form && overviewInitial ? (
        <section className="mt-12">
          <h2 className="font-serif text-2xl text-ink-900">Welke gegevens hebben we van jou?</h2>
          <p className="mt-1 text-sm text-ink-500">
            Dit zijn de bedrijfsgegevens die we op dit moment van je bewaren. Kloppen ze niet, of wil
            je iets verwijderen? Gebruik het formulier hierboven, of pas ze zelf aan bij{" "}
            <a href="/client/onboarding" className="text-burgundy underline-offset-4 hover:underline">
              je bedrijfsgegevens
            </a>
            . Facturatiegegevens worden apart beheerd en staan hier niet bij.
          </p>
          <div className="mt-5">
            <ClientDataOverview form={form} initial={overviewInitial} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
