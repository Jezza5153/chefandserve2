/**
 * /client/profile — what the office sees about your company.
 *
 * Loaded from the client row Maarten/Gina converted out of the Jotform
 * submission. Read-only for Phase 1.
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients } from "@/lib/db/schema";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Mijn profiel" };
export const dynamic = "force-dynamic";

const SEGMENT_LABELS: Record<string, string> = {
  casual: "Casual",
  fine_dining: "Fine dining",
  hotel: "Hotel",
  banqueting: "Banqueting",
  catering: "Catering",
  event: "Event",
  corporate: "Corporate",
};

export default async function ClientProfilePage() {
  const session = await requireAuth("/client/profile");

  const [c] = await db
    .select()
    .from(clients)
    .where(eq(clients.userId, session.user.id))
    .limit(1);

  if (!c) {
    return (
      <div>
        <h1 className="font-serif text-3xl text-ink-900">Geen profiel gevonden</h1>
        <p className="mt-4 text-sm text-ink-700">
          Je account is wel actief, maar er is nog geen klant-profiel aan je
          gekoppeld. Stuur een berichtje naar het kantoor.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Mijn profiel
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        {c.companyName}
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        Wat het kantoor over je bedrijf heeft staan. Klopt iets niet?{" "}
        <a
          href="mailto:info@chefandserve.nl"
          className="text-burgundy hover:underline"
        >
          Mail het kantoor
        </a>
        .
      </p>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <Section title="Contact">
          <Row label="Contactpersoon" value={c.contactName ?? "—"} />
          <Row label="E-mail" value={c.email ?? "—"} />
          <Row label="Telefoon" value={c.phone ?? "—"} />
        </Section>

        <Section title="Bedrijf">
          <Row label="Bedrijfsnaam" value={c.companyName} />
          <Row
            label="Segment"
            value={c.segment ? SEGMENT_LABELS[c.segment] ?? c.segment : "—"}
          />
          <Row label="Adres" value={c.address ?? "—"} />
          <Row label="Stad" value={c.city ?? "—"} />
        </Section>

        <Section title="Administratie">
          <Row label="KvK" value={c.kvk ?? "—"} />
          <Row label="BTW" value={c.btw ?? "—"} />
          <Row label="Factuur-e-mail" value={c.billingEmail ?? c.email ?? "—"} />
          <Row
            label="Betalingstermijn"
            value={c.paymentTermsDays ? `${c.paymentTermsDays} dagen` : "14 dagen"}
          />
        </Section>

        <Section title="Status">
          <Row label="Klant sinds" value={c.joinedAt ? new Date(c.joinedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "—"} />
          <Row label="Status" value={statusLabel(c.status)} />
        </Section>
      </div>

      {c.notes ? (
        <div className="mt-10">
          <h2 className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Notities van het kantoor
          </h2>
          <p className="mt-2 rounded border border-ink-200 bg-white p-4 text-sm leading-relaxed text-ink-700 whitespace-pre-wrap">
            {c.notes}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-5">
      <h2 className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
        {title}
      </h2>
      <dl className="mt-4 space-y-2 text-sm">{children}</dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-baseline gap-3">
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
