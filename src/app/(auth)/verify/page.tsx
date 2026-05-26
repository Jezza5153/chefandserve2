import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/site";

/**
 * Verify-email-sent confirmation page.
 *
 * Shown after a user submits the /login form. The real flow ships in PR-0E:
 * user enters email → Auth.js sends magic link via Resend → user lands here
 * → they check their email and click the link → land on /admin.
 *
 * Phase 0 stub renders the same UI without the underlying send.
 */
export const metadata: Metadata = {
  title: "Controleer je e-mail",
  description: "Inloglink verstuurd. Klik in je inbox om in te loggen.",
};

export default function VerifyPage() {
  return (
    <div className="mx-auto w-full max-w-md rounded-lg border border-burgundy/15 bg-white p-8 text-center md:p-10">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Stap 2 van 2
      </p>
      <h1 className="mt-3 font-serif text-3xl text-ink-900 md:text-4xl">
        Controleer je e-mail
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-700">
        We hebben een inloglink gestuurd naar het adres dat je hebt opgegeven.
        Klik in je inbox op de link om door te gaan. De link is 15 minuten
        geldig.
      </p>

      <div className="mt-6 rounded border border-ink-200 bg-bg-gray px-4 py-3 text-left text-xs leading-relaxed text-ink-700">
        <strong className="text-ink-900">Geen e-mail ontvangen?</strong>
        <br />
        Check je spam- of ongewenste-mailmap. Komt het bericht niet binnen?
        Mail dan{" "}
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
