import { site } from "@/lib/site";

/**
 * Dark cinematic closing CTA block. Used on most pages.
 * Same shape as the homepage's final section.
 */
export function ClosingCTA({
  eyebrow = "De juiste mensen, op het juiste moment",
  heading = "Klaar om uw team te versterken?",
  body = "Stuur een mail of bel direct — Maarten of het team reageert binnen een uur tijdens werkdagen.",
}: {
  eyebrow?: string;
  heading?: string;
  body?: string;
}) {
  return (
    <section className="bg-ink-900 py-20 text-center text-white md:py-28">
      <div className="mx-auto max-w-container px-4">
        <p className="font-ui text-[11px] uppercase tracking-[0.3em] text-cream">
          {eyebrow}
        </p>
        <h2 className="mx-auto mt-3 max-w-3xl font-serif text-3xl text-white md:text-5xl">
          {heading}
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-white/75">{body}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a
            href={`mailto:${site.email}`}
            className="rounded-full bg-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-900 transition-colors hover:bg-cream"
          >
            Mail ons
          </a>
          <a
            href={`tel:${site.phone}`}
            className="rounded-full border border-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-white hover:text-ink-900"
          >
            Bel {site.phoneDisplay}
          </a>
        </div>
      </div>
    </section>
  );
}
