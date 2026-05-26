import type { Metadata } from "next";

/**
 * Admin index — Phase 0 placeholder.
 *
 * PR-0F will replace this with a role-based redirect:
 *   super_admin → /admin/system
 *   owner       → /admin/business
 *
 * For now, this is just a stub so the (admin) route group is reachable.
 */
export const metadata: Metadata = {
  title: "Dashboard",
};

export default function AdminIndexPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Phase 0 — Build in progress
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        Operations dashboard
      </h1>
      <p className="mt-6 text-base leading-relaxed text-ink-700 md:text-lg">
        Dit is de plek waar Maarten en het team straks de hele dagelijkse
        operatie bedienen — chef-matches, klant-aanvragen, shifts, uren,
        facturatie. Alles in één scherm, getailord op het premium-segment.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <PlaceholderCard
          title="Inbox"
          body="Nieuwe chef- en klant-aanmeldingen via Jotform. Eén klik om een aanmelding om te zetten naar een volledig profiel."
          phase="Phase 1"
        />
        <PlaceholderCard
          title="Chefs"
          body="200+ gescreende koks en hospitality-professionals. Profiel, vakniveau, beschikbaarheid, geschiedenis, documenten."
          phase="Phase 2"
        />
        <PlaceholderCard
          title="Roster"
          body="Slepen-en-neerzetten weekrooster met automatische match-suggesties. Geen dubbele boekingen, geen conflicten."
          phase="Phase 3"
        />
        <PlaceholderCard
          title="Hours & Payingit"
          body="Uren-goedkeuring, automatische sync naar Payingit elke vrijdag voor payroll en facturatie."
          phase="Phase 5"
        />
      </div>

      <div className="mt-12 rounded-lg border border-burgundy/15 bg-white p-6 md:p-8">
        <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Volgende stap
        </p>
        <h2 className="mt-2 font-serif text-xl text-ink-900 md:text-2xl">
          PR-0E: magic-link login
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-700">
          Vanaf PR-0E kunnen Maarten, Gina en Jezza inloggen via een
          eenmalige link in hun e-mail. Zodra dat live is, vervangt PR-0F
          deze placeholder met de daadwerkelijke role-aware dashboards.
        </p>
      </div>
    </div>
  );
}

function PlaceholderCard({
  title,
  body,
  phase,
}: {
  title: string;
  body: string;
  phase: string;
}) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-6">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-serif text-lg text-ink-900">{title}</h3>
        <span className="shrink-0 rounded-full bg-burgundy/10 px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider text-burgundy">
          {phase}
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink-700">{body}</p>
    </div>
  );
}
