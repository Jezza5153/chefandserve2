/**
 * /chef/profile — what the office sees about you.
 *
 * Loaded from the chef row Maarten/Gina converted out of the Jotform
 * submission. Read-only for Phase 1. Editable fields (phone, city,
 * specialties, languages, notes) ship in a follow-up if needed.
 *
 * Photo: pulled from chef_documents type='photo' if R2 is wired. Shows
 * a placeholder otherwise.
 */

import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefDocuments, chefs } from "@/lib/db/schema";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Mijn profiel" };
export const dynamic = "force-dynamic";

const VAKNIVEAU_LABELS: Record<string, string> = {
  keukenhulp: "Keukenhulp",
  commis: "Commis chef",
  chef_de_partie: "Chef de partie",
  sous_chef: "Sous-chef",
  chef_de_cuisine: "Chef de cuisine",
  executive_chef: "Executive chef",
  patissier: "Patissier",
  banqueting: "Banqueting",
  breakfast: "Breakfast",
  roomservice: "Roomservice",
  bediening: "Bediening",
  host: "Host(ess)",
  runner: "Runner",
  other: "Anders",
};

const SEGMENT_LABELS: Record<string, string> = {
  casual: "Casual",
  fine_dining: "Fine dining",
  hotel: "Hotel",
  banqueting: "Banqueting",
  catering: "Catering",
  event: "Event",
  corporate: "Corporate",
};

export default async function ChefProfilePage() {
  const session = await requireAuth("/chef/profile");

  const [chef] = await db
    .select()
    .from(chefs)
    .where(eq(chefs.userId, session.user.id))
    .limit(1);

  if (!chef) {
    return (
      <div>
        <h1 className="font-serif text-3xl text-ink-900">Geen profiel gevonden</h1>
        <p className="mt-4 text-sm text-ink-700">
          Je account is wel actief, maar er is nog geen chef-profiel aan je
          gekoppeld. Stuur een berichtje naar Maarten of Gina.
        </p>
      </div>
    );
  }

  const [photo] = await db
    .select({ id: chefDocuments.id })
    .from(chefDocuments)
    .where(
      and(
        eq(chefDocuments.chefId, chef.id),
        eq(chefDocuments.type, "photo"),
        isNull(chefDocuments.deletedAt),
      ),
    )
    .orderBy(desc(chefDocuments.createdAt))
    .limit(1);

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Mijn profiel
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        {chef.fullName}
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        Wat het kantoor over jou heeft staan. Klopt iets niet?{" "}
        <a
          href="mailto:info@chefandserve.nl"
          className="text-burgundy hover:underline"
        >
          Mail het kantoor
        </a>{" "}
        — we passen het binnen een dag aan.
      </p>

      <div className="mt-8 grid gap-6 sm:grid-cols-[120px_1fr]">
        <div className="aspect-square overflow-hidden rounded-lg border border-ink-200 bg-bg-gray">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/chef-photo/${photo.id}`}
              alt={chef.fullName}
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center font-serif text-3xl text-ink-200">
              {chef.fullName
                .split(" ")
                .map((p) => p[0])
                .filter(Boolean)
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>
          )}
        </div>

        <dl className="space-y-3 text-sm">
          <Row label="E-mail" value={chef.email ?? "—"} />
          <Row label="Telefoon" value={chef.phone ?? "—"} />
          <Row label="Stad" value={chef.city ?? "—"} />
          <Row
            label="Vakniveau"
            value={chef.vakniveau ? VAKNIVEAU_LABELS[chef.vakniveau] ?? chef.vakniveau : "—"}
          />
          <Row
            label="Segmenten"
            value={
              chef.segments && chef.segments.length > 0
                ? chef.segments
                    .map((s) => SEGMENT_LABELS[s] ?? s)
                    .join(", ")
                : "—"
            }
          />
          <Row label="Specialteiten" value={chef.specialties ?? "—"} />
          <Row
            label="Talen"
            value={
              chef.languages && chef.languages.length > 0
                ? chef.languages.join(", ").toUpperCase()
                : "—"
            }
          />
          <Row
            label="Ervaring"
            value={chef.yearsExperience ? `${chef.yearsExperience} jaar` : "—"}
          />
          <Row
            label="Aangemeld op"
            value={
              chef.joinedAt
                ? new Date(chef.joinedAt).toLocaleDateString("nl-NL", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "—"
            }
          />
          <Row label="Status" value={statusLabel(chef.status)} />
        </dl>
      </div>

      {chef.notes ? (
        <div className="mt-10">
          <h2 className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Notities van het kantoor
          </h2>
          <p className="mt-2 rounded border border-ink-200 bg-white p-4 text-sm leading-relaxed text-ink-700 whitespace-pre-wrap">
            {chef.notes}
          </p>
        </div>
      ) : null}

      <p className="mt-12 text-xs leading-relaxed text-ink-500">
        Deze informatie komt uit je oorspronkelijke Jotform-aanmelding. Wij
        breiden je profiel uit met inzichten uit elke shift (zonder dat jij
        iets hoeft te doen).
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-baseline gap-3">
      <dt className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
        {label}
      </dt>
      <dd className="text-ink-900">{value}</dd>
    </div>
  );
}

function statusLabel(status: string): string {
  return (
    {
      active: "Actief",
      onboarding: "Onboarding",
      paused: "Gepauzeerd",
      inactive: "Inactief",
      archived: "Gearchiveerd",
    } as Record<string, string>
  )[status] ?? status;
}
