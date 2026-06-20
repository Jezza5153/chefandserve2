/**
 * /chef/money — CHEF-PR8 Money Explainer. Bruto/netto/ZZP INDICATIE calculator.
 * Dark behind MONEY_EXPLAINER_ENABLED (owner verifies the assumption table first).
 */
import { env } from "@/lib/env";
import { getMoneyAssumptions } from "@/lib/business-settings";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n/locales";
import { requireAuth } from "@/lib/permissions";

import { ChefHelp } from "@/components/chef/ChefHelp";

import { MoneyCalculator } from "./MoneyCalculator";

export const metadata = { title: "Geld uitgelegd" };
export const dynamic = "force-dynamic";

const LABEL = "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy";

export default async function ChefMoneyPage() {
  await requireAuth("/chef/money");
  const { dict: t } = await getI18n();
  const assumptions = await getMoneyAssumptions();

  if (env.MONEY_EXPLAINER_ENABLED !== "true") {
    return (
      <div>
        <p className={LABEL}>{t.money.eyebrow}</p>
        <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">{t.nav.moneyExplained}</h1>
        <p className="mt-6 rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          {t.money.comingSoon}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className={LABEL}>{t.money.eyebrow}</p>
        <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">{t.money.title}</h1>
        <p className="mt-2 text-sm text-ink-600">
          {t.money.introA}
          <strong>{t.common.estimate}</strong>
          {t.money.introB}
        </p>
      </div>

      <MoneyCalculator assumptions={assumptions} />

      {/* CHEF-PR8: money FAQ. ChefHelp is shared with the dashboard and not yet
          localised (deferred to the dashboard i18n pass) → keep the NL title so it
          matches the still-NL FAQ content rather than showing a half-translated block. */}
      <ChefHelp topics={["geld", "algemeen"]} title="Vragen over geld" />

      <p className="text-[11px] leading-relaxed text-ink-400">
        {fill(t.money.assumptionsFooter, { date: assumptions.lastUpdated, source: assumptions.source })}
      </p>
    </div>
  );
}
