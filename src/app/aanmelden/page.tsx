/**
 * /aanmelden — sign-up choice page.
 *
 * The header has two CTAs: "Inloggen" → /login (for people who already
 * have an account), and "Aanmelden" → this page (for new people).
 *
 * We ask one question — "ben je chef of klant?" — then send them to the
 * matching Jotform that's already wired into our webhook intake pipeline.
 * Once they submit, the webhook lands in /admin/business/inbox, Maarten
 * reviews + converts, then activates portal access.
 *
 * Marketing layout (ChromeShell renders Header/Footer for this route).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Aanmelden — Chef of klant?",
  description:
    "Aanmelden bij Chef & Serve. Ben je chef en zoek je werk? Of ben je restaurant / hotel en zoek je personeel? Kies hieronder.",
  alternates: { canonical: "/aanmelden" },
};

export default function AanmeldenPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16 md:py-24">
      <div className="text-center">
        <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Aanmelden
        </p>
        <h1 className="mt-4 font-serif text-4xl text-ink-900 md:text-6xl">
          Wat ben jij?
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-ink-700 md:text-lg">
          Twee korte aanmeldformulieren — kies welke bij je past. Wij nemen
          binnen één werkdag persoonlijk contact op.
        </p>
      </div>

      <div className="mt-14 grid gap-6 md:grid-cols-2">
        {/* Chef card */}
        <Card
          eyebrow="Voor koks &amp; horecaprofessionals"
          title="Ik ben chef"
          body="Werk via Chef & Serve — premium shifts bij Amsterdamse fine-dining, hotels en banqueting. Je kiest zelf wanneer en waar je werkt. Wij regelen de papieren en zorgen voor goede tarieven."
          bullets={[
            "Werk waar en wanneer je wilt",
            "€32 — €55 per uur, marktconform",
            "Geen ZZP-stress — payroll geregeld",
            "Persoonlijk contact, geen app-bureaucratie",
          ]}
          cta={{
            href: site.jotform.chef,
            label: "Aanmelden als chef",
          }}
        />

        {/* Klant card */}
        <Card
          eyebrow="Voor restaurants, hotels &amp; catering"
          title="Ik ben restaurant of hotel"
          body="Vraag een gescreende kok aan voor een avond, een week of een vast seizoen. Wij matchen handmatig — geen algoritme die je een ongeschikte chef stuurt. Reactie binnen 4 werkuren."
          bullets={[
            "200+ gescreende koks in ons netwerk",
            "Persoonlijke match door Maarten of Gina",
            "Korte termijn én structureel",
            "Volledig payroll-conform (geen wet-DBA-risico)",
          ]}
          cta={{
            href: site.jotform.client,
            label: "Personeel aanvragen",
          }}
        />
      </div>

      <div className="mt-14 text-center text-sm text-ink-700">
        <p>
          Al een account?{" "}
          <Link href="/login" className="font-medium text-burgundy hover:underline">
            Inloggen →
          </Link>
        </p>
      </div>

      <p className="mt-16 text-center text-xs leading-relaxed text-ink-500">
        Voorkeur voor telefonisch contact? Bel{" "}
        <a
          href={`tel:${site.phone}`}
          className="text-burgundy hover:underline"
        >
          {site.phoneDisplay}
        </a>{" "}
        — Maarten of Gina helpt je verder.
      </p>
    </main>
  );
}

/* ----- card component ------------------------------------------------- */

type CardProps = {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  cta: { href: string; label: string };
};

function Card({ eyebrow, title, body, bullets, cta }: CardProps) {
  return (
    <article className="group flex flex-col rounded-2xl border border-ink-200 bg-white p-8 transition-colors hover:border-burgundy/40 md:p-10">
      <p
        className="font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy"
        dangerouslySetInnerHTML={{ __html: eyebrow }}
      />
      <h2 className="mt-3 font-serif text-3xl text-ink-900 md:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-sm leading-relaxed text-ink-700 md:text-base">
        {body}
      </p>

      <ul className="mt-6 space-y-2 text-sm text-ink-700">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <span
              className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-burgundy"
              aria-hidden
            />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <div className="mt-8 grow" />

      <a
        href={cta.href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block rounded-full bg-burgundy px-6 py-3 text-center font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900"
      >
        {cta.label} →
      </a>

      <p className="mt-3 text-center text-[11px] text-ink-500">
        Opent het aanmeldformulier in een nieuw tabblad
      </p>
    </article>
  );
}
