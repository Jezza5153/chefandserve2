import { requireAuth } from "@/lib/permissions";
import { getPublishedForm } from "@/lib/domain/forms";
import { CLIENT_ONBOARDING_FORM_SLUG, getClientByUserId, hydrateFormState } from "@/lib/domain/client-onboarding";
import { r2IsConfigured } from "@/lib/r2";
import { site } from "@/lib/site";

import { OnboardingWizard } from "./OnboardingWizard";

export const metadata = { title: "Bedrijfsgegevens", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ClientOnboardingPage() {
  const session = await requireAuth("/client/onboarding");
  const client = await getClientByUserId(session.user.id);

  if (!client) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-6">
        <h1 className="font-serif text-2xl text-ink-900">Profiel ontbreekt</h1>
        <p className="mt-2 text-sm text-ink-700">
          Er is nog geen klant-profiel aan dit account gekoppeld. Mail ons via{" "}
          <a href={`mailto:${site.email}`} className="text-burgundy underline-offset-4 hover:underline">
            {site.email}
          </a>
          .
        </p>
      </div>
    );
  }

  const form = await getPublishedForm(CLIENT_ONBOARDING_FORM_SLUG);
  if (!form) {
    return (
      <div className="rounded-lg border border-ink-200 bg-white p-6">
        <h1 className="font-serif text-2xl text-ink-900">Onboarding</h1>
        <p className="mt-2 text-sm text-ink-700">Het onboardingformulier is nog niet beschikbaar.</p>
      </div>
    );
  }

  const initial = await hydrateFormState(form, client);

  return (
    <OnboardingWizard
      form={form}
      initial={initial}
      submitted={client.onboardingStatus === "submitted"}
      r2Configured={r2IsConfigured()}
    />
  );
}
