import { site } from "@/lib/site";

export const metadata = { title: "Nieuwe aanvraag" };

export default function ClientRequestPage() {
  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Nieuwe aanvraag
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        Vraag personeel aan
      </h1>
      <p className="mt-4 text-sm text-ink-700">
        Vertel ons wat je nodig hebt — wij matchen handmatig binnen 4-24 uur.
      </p>

      <div className="mt-8 rounded-lg border border-burgundy/20 bg-burgundy/5 p-6 text-center">
        <p className="font-serif text-lg text-ink-900">
          Aanvraag-formulier binnenkort in dit portaal
        </p>
        <p className="mt-2 text-sm text-ink-700">
          Voor nu — gebruik ons aanmeldformulier of mail{" "}
          <a
            href={`mailto:${site.email}`}
            className="text-burgundy underline-offset-4 hover:underline"
          >
            {site.email}
          </a>
          .
        </p>
        <a
          href={site.jotform.client}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-block rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
        >
          Open aanmeldformulier →
        </a>
      </div>
    </div>
  );
}
