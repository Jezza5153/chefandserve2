import type { Metadata } from "next";

import { CLIENT_REQUEST_FORM_SLUG } from "@/lib/domain/client-requests";
import { getPublishedForm } from "@/lib/domain/forms";
import { site } from "@/lib/site";

import { ClientRequestForm } from "./ClientRequestForm";

export const metadata: Metadata = {
  title: "Horecapersoneel aanvragen — Chef & Serve",
  description:
    "Vraag chefs, koks of bediening aan bij Chef & Serve. Laat weten wat je zoekt — we koppelen je binnen 4 werkuren aan de juiste professionals.",
  alternates: { canonical: "/horeca-personeel-aanvragen/" },
};

export const dynamic = "force-dynamic";

export default async function AanvragenPage() {
  const form = await getPublishedForm(CLIENT_REQUEST_FORM_SLUG);

  return (
    <main className="bg-bg-gray py-16 md:py-24">
      <div className="mx-auto max-w-xl px-4">
        <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Aanvragen</p>
        <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
          {form?.title ?? "Horecapersoneel aanvragen"}
        </h1>
        {form?.description ? (
          <p className="mt-3 text-sm leading-relaxed text-ink-700">{form.description}</p>
        ) : null}

        <div className="mt-8">
          {form ? (
            <ClientRequestForm form={form} />
          ) : (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800">
              Het aanvraagformulier is tijdelijk niet beschikbaar. Mail ons gerust via{" "}
              <a href={`mailto:${site.email}`} className="font-medium underline-offset-4 hover:underline">
                {site.email}
              </a>
              .
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
