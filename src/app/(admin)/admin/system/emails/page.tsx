/**
 * Email template gallery — super_admin only.
 *
 * Shows each transactional template rendered with sample data so we can
 * sanity-check before sending real ones. Each preview is sandboxed in an
 * iframe so its inline styles don't bleed into the admin shell.
 *
 * Sister route /admin/system/emails/[template] renders a single template's
 * HTML on its own URL — that's what we point the iframe `src` at.
 */
import Link from "next/link";

import { requireRole } from "@/lib/permissions";
import { sampleProps, type TemplateKey } from "./_samples";

export const metadata = { title: "Email preview" };
export const dynamic = "force-dynamic";

const TEMPLATES: Array<{
  key: TemplateKey;
  label: string;
  subject: string;
  description: string;
}> = [
  {
    key: "magic-link",
    label: "Magic link",
    subject: "Je inloglink",
    description:
      "Verstuurd wanneer iemand zijn email invult op /login. Geldig 15 min, eenmalig.",
  },
  {
    key: "shift-proposed",
    label: "Shift voorgesteld",
    subject: "Nieuwe shift voor je",
    description:
      "Verstuurd naar de chef zodra Maarten ze als kandidaat plaatst.",
  },
  {
    key: "shift-confirmed-client",
    label: "Shift bevestigd → klant",
    subject: "Je chef is bevestigd",
    description:
      "Verstuurd naar de klant zodra de chef de shift accepteert.",
  },
  {
    key: "portal-invite",
    label: "Portal uitnodiging",
    subject: "Welkom bij Chef & Serve",
    description:
      "Verstuurd wanneer chef of klant toegang krijgt tot het portal.",
  },
];

export default async function EmailGalleryPage() {
  await requireRole("super_admin");

  return (
    <div className="mx-auto max-w-6xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Email preview
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        Transactional templates
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-700 md:text-base">
        Alle emails die het systeem verstuurt, met sample-data. Bekijk hier
        hoe ze er bij Maarten / Gina / de chef / de klant uitzien voordat ze
        live gaan. Iframes zijn 1:1 wat Resend uitstuurt.
      </p>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        {TEMPLATES.map((t) => (
          <article
            key={t.key}
            className="overflow-hidden rounded-lg border border-ink-200 bg-white"
          >
            <header className="border-b border-ink-200 px-5 py-4">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-serif text-xl text-ink-900">{t.label}</h2>
                <Link
                  href={`/api/admin/emails/${t.key}`}
                  className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy hover:underline"
                >
                  Open in nieuw tab →
                </Link>
              </div>
              <p className="mt-1 text-xs text-ink-500">
                Subject: <strong className="text-ink-900">{t.subject}</strong>
              </p>
              <p className="mt-2 text-xs leading-relaxed text-ink-700">
                {t.description}
              </p>
            </header>
            <iframe
              src={`/api/admin/emails/${t.key}`}
              className="block h-[480px] w-full border-0 bg-bg-gray"
              title={`${t.label} preview`}
            />
          </article>
        ))}
      </div>

      <details className="mt-12 rounded border border-ink-200 bg-white p-5 text-sm">
        <summary className="cursor-pointer font-ui text-xs font-medium uppercase tracking-wider text-ink-900">
          Sample-data gebruikt voor previews
        </summary>
        <pre className="mt-3 overflow-x-auto rounded bg-bg-gray p-3 text-[11px] leading-relaxed">
          {JSON.stringify(sampleProps, null, 2)}
        </pre>
      </details>
    </div>
  );
}

