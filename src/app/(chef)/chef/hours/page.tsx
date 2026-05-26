import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Uren" };

export default async function ChefHoursPage() {
  await requireAuth();
  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Uren
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        Mijn uren
      </h1>
      <p className="mt-4 text-sm text-ink-700">
        Na elke shift dien je hier je uren in. Maarten keurt ze goed en wij
        sturen ze naar Payingit voor uitbetaling.
      </p>

      <div className="mt-8 rounded-lg border border-burgundy/20 bg-burgundy/5 p-6 text-center">
        <p className="font-serif text-lg text-ink-900">
          Uren-formulier binnenkort
        </p>
        <p className="mt-2 text-sm text-ink-700">
          Phase 5 voegt: uren indienen per shift · Payingit-sync ·
          uitbetalingsstatus.
        </p>
      </div>
    </div>
  );
}
