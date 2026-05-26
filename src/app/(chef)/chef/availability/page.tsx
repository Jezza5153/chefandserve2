import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Beschikbaarheid" };

export default async function ChefAvailabilityPage() {
  await requireAuth();
  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Beschikbaarheid
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        Mijn agenda
      </h1>
      <p className="mt-4 text-sm text-ink-700">
        Standaard ben je elke dag beschikbaar. Hieronder kun je
        specifieke dagen blokkeren (vakantie, andere afspraken).
      </p>

      <div className="mt-8 rounded-lg border border-burgundy/20 bg-burgundy/5 p-6 text-center">
        <p className="font-serif text-lg text-ink-900">Kalender-UI binnenkort</p>
        <p className="mt-2 text-sm text-ink-700">
          Voor nu — bel of mail het kantoor als je dagen wilt blokkeren.
        </p>
      </div>
    </div>
  );
}
