import type { Metadata } from "next";

import { APPLY_FORM_SLUG } from "@/lib/domain/applications";
import { getPublishedForm } from "@/lib/domain/forms";
import { site } from "@/lib/site";

import { ApplyForm } from "./ApplyForm";

export const metadata: Metadata = {
  title: "Werken bij Chef & Serve — Aanmelden",
  description:
    "Meld je aan als chef, kok of bediening bij Chef & Serve. Laat je gegevens achter — we nemen binnen één werkdag contact op.",
  alternates: { canonical: "/sollicitatie/" },
};

export const dynamic = "force-dynamic";

export default async function SollicitatiePage() {
  const form = await getPublishedForm(APPLY_FORM_SLUG);

  return (
    <main className="bg-bg-gray py-16 md:py-24">
      <div className="mx-auto max-w-xl px-4">
        <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Aanmelden</p>
        <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
          {form?.title ?? "Werken bij Chef & Serve"}
        </h1>
        {form?.description ? (
          <p className="mt-3 text-sm leading-relaxed text-ink-700">{form.description}</p>
        ) : null}

        <div className="mt-8">
          {form ? (
            <ApplyForm form={form} />
          ) : (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800">
              Het aanmeldformulier is tijdelijk niet beschikbaar. Mail ons gerust via{" "}
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
