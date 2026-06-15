/**
 * /chef/money — CHEF-PR8 Money Explainer. Bruto/netto/ZZP INDICATIE calculator.
 * Dark behind MONEY_EXPLAINER_ENABLED (owner verifies the assumption table first).
 */
import { env } from "@/lib/env";
import { MONEY_ASSUMPTIONS } from "@/lib/money";
import { requireAuth } from "@/lib/permissions";

import { MoneyCalculator } from "./MoneyCalculator";

export const metadata = { title: "Geld uitgelegd" };
export const dynamic = "force-dynamic";

const LABEL = "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy";

export default async function ChefMoneyPage() {
  await requireAuth("/chef/money");

  if (env.MONEY_EXPLAINER_ENABLED !== "true") {
    return (
      <div>
        <p className={LABEL}>Geld</p>
        <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">Geld uitgelegd</h1>
        <p className="mt-6 rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          De bruto/netto-uitleg is er binnenkort.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className={LABEL}>Geld</p>
        <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
          Bruto · netto · ZZP — uitgelegd
        </h1>
        <p className="mt-2 text-sm text-ink-600">
          Reken snel uit wat een shift ongeveer oplevert — payroll of zzp. Het is een{" "}
          <strong>indicatie</strong>, geen loonstrook.
        </p>
      </div>

      <MoneyCalculator />

      <p className="text-[11px] leading-relaxed text-ink-400">
        Aannames bijgewerkt {MONEY_ASSUMPTIONS.lastUpdated}. Bron: {MONEY_ASSUMPTIONS.source}
      </p>
    </div>
  );
}
