import type { Metadata } from "next";
import Link from "next/link";

import { site } from "@/lib/site";

/**
 * "Check je e-mail" — shown after a successful magic-link submission.
 *
 * For security we display the same UI whether the email was real or not.
 * If the email matches an active seeded user, Resend sends the link.
 * If not, no email is sent — but the page looks identical so we don't
 * leak which emails exist.
 */
export const metadata: Metadata = {
  title: "Controleer je e-mail",
  description: "Inloglink verstuurd. Klik in je inbox om in te loggen.",
};

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;
  const recipient = params.email?.trim().toLowerCase();

  return (
    <div className="mx-auto w-full max-w-md rounded-lg border border-burgundy/15 bg-white p-8 text-center md:p-10">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Stap 2 van 2
      </p>
      <h1 className="mt-3 font-serif text-3xl text-ink-900 md:text-4xl">
        Controleer je e-mail
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-700">
        We hebben een inloglink gestuurd
        {recipient ? (
          <>
            {" "}naar <strong className="text-ink-900">{recipient}</strong>
          </>
        ) : null}
        . Klik in je inbox op de link om door te gaan. De link is{" "}
        <strong>15 minuten</strong> geldig en kan maar één keer worden gebruikt.
      </p>

      <div className="mt-6 rounded border border-ink-200 bg-bg-gray px-4 py-3 text-left text-xs leading-relaxed text-ink-700">
        <strong className="text-ink-900">Geen e-mail ontvangen?</strong>
        <br />
        Check je spam-map. Niet-geactiveerde accounts ontvangen geen mail —
        neem dan contact op met{" "}
        <a
          href={`mailto:${site.email}`}
          className="text-burgundy underline-offset-4 hover:underline"
        >
          {site.email}
        </a>
        .
      </div>

      <p className="mt-6 text-xs text-ink-500">
        <Link
          href="/login"
          className="text-burgundy underline-offset-4 hover:underline"
        >
          ← Probeer een ander e-mailadres
        </Link>
      </p>
    </div>
  );
}
