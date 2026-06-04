/**
 * /admin/business/insights — KPI-4. Owner-only ranglijsten over the KPI snapshot.
 * Read-only; every board comes from leaderboards.ts (windowed, index-scanned, honest
 * gates). Cold-start safe: shows a "snapshot nog niet gevuld" hint when empty.
 */
import { getLeaderboards } from "@/lib/domain/leaderboards";
import { LeaderboardCard } from "@/components/dashboard/LeaderboardCard";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Analyse", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  await requireRole("owner");
  const lb = await getLeaderboards(90, 5);
  const empty =
    lb.topEarners.length === 0 && lb.busiest.length === 0 && lb.topClients.length === 0;

  return (
    <div className="max-w-5xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Analyse</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Ranglijsten</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-600">
        Top-prestaties over de laatste {lb.windowDays} dagen, opgebouwd uit de dagelijkse snapshot.
        Bedragen komen uit goedgekeurde uren; “best beoordeeld” telt pas mee vanaf 5 reviews en
        “meest betrouwbaar” vanaf 5 voorstellen.
      </p>

      {empty ? (
        <div className="mt-6 rounded-lg border border-dashed border-ink-200 bg-bg-gray/40 p-6 text-sm text-ink-500">
          Nog geen snapshot-data in dit venster. De ranglijsten vullen zich zodra de nachtelijke
          <span className="font-mono"> metrics-snapshot</span> heeft gedraaid (of na een handmatige backfill).
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <LeaderboardCard title="Top verdieners" icon="banknote" entries={lb.topEarners} />
          <LeaderboardCard title="Meeste diensten" icon="activity" entries={lb.busiest} />
          <LeaderboardCard
            title="Meest betrouwbaar"
            icon="check-circle"
            entries={lb.mostReliable}
            emptyHint="Nog niemand met ≥ 5 voorstellen in dit venster."
          />
          <LeaderboardCard
            title="Best beoordeeld"
            icon="sparkles"
            entries={lb.highestRated}
            emptyHint="Nog niemand met ≥ 5 reviews in dit venster."
          />
          <LeaderboardCard title="Grootste klanten" icon="building" entries={lb.topClients} />
        </div>
      )}
    </div>
  );
}
