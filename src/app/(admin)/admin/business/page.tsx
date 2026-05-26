import { requireRole } from "@/lib/permissions";

/**
 * Owner/Maarten dashboard.
 *
 * Phase 0: empty placeholder showing what's coming.
 * Phase 1+ fills with real Inbox, recent shifts, financial pulse, etc.
 *
 * Access: owner OR super_admin (super_admin can navigate here freely).
 */
export const metadata = { title: "Dashboard" };

export default async function BusinessDashboardPage() {
  // super_admin can also see this — we use requireRole("owner") which
  // allows super_admin via the role hierarchy convention in defaultLandingFor.
  // Explicit check: if the user has neither role, redirect.
  const session = await requireRole("owner");

  return (
    <div className="mx-auto max-w-3xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Operations · {session.user.roles.join(" + ")}
      </p>
      <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
        Goedemorgen
        {session.user.name ? `, ${session.user.name.split(" ")[0]}` : ""}
      </h1>
      <p className="mt-6 text-base leading-relaxed text-ink-700 md:text-lg">
        Welkom in de operations cockpit van Chef &amp; Serve. Hier
        organiseer je de dagelijkse matches tussen chefs en klanten —
        Inbox, Chefs, Clients, Shifts, Roster en Hours komen in
        opvolgende phases binnen.
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
