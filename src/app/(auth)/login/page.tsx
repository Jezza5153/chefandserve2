import type { Metadata } from "next";

/**
 * Login stub — Phase 0 placeholder.
 *
 * Real magic-link sign-in form ships in PR-0E (Auth.js v5 + Resend).
 * For now this page exists to:
 *   - Confirm the (auth) route group works
 *   - Give the middleware a redirect target for unauthed admin routes
 *   - Make it possible to share/QA the URL shape with the team
 */
export const metadata: Metadata = {
  title: "Inloggen",
  description: "Toegang voor interne gebruikers van Chef & Serve.",
};

export default function LoginPage() {
  return (
    <div className="mx-auto w-full max-w-md rounded-lg border border-burgundy/15 bg-white p-8 md:p-10">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Inloggen
      </p>
      <h1 className="mt-3 font-serif text-3xl text-ink-900 md:text-4xl">
        Welkom terug
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-700">
        Toegang is voorbehouden aan interne gebruikers van Chef &amp; Serve.
        Vul je e-mailadres in en we sturen een eenmalige inloglink — geen
        wachtwoord nodig.
      </p>

      <form
        action="#"
        method="post"
        className="mt-8 space-y-4"
        aria-label="Inlogformulier"
      >
        <div>
          <label
            htmlFor="email"
            className="mb-2 block font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy"
          >
            E-mailadres
          </label>
          <input
            type="email"
            id="email"
            name="email"
            placeholder="jij@chefandserve.nl"
            disabled
            className="w-full rounded border border-ink-200 bg-bg-gray px-4 py-3 text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy disabled:opacity-60"
          />
        </div>

        <button
          type="submit"
          disabled
          className="w-full rounded-full bg-burgundy px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900 disabled:opacity-60"
        >
          Stuur inloglink
        </button>
      </form>

      <p className="mt-8 rounded border border-cream/40 bg-cream/10 px-4 py-3 text-xs leading-relaxed text-ink-700">
        <strong className="text-burgundy">Phase 0 placeholder.</strong> Magic-link
        login is in PR-0E. Tot dan kan dit formulier nog niet versturen.
      </p>
    </div>
  );
}
