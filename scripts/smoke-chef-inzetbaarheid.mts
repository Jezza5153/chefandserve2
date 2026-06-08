/**
 * Smoke: computeChefInzetbaarheid — the chef deployability verdict.
 *
 * Pure-function regression guard. Asserts the level/blocker/warning logic for the
 * realistic cases an operator hits: fully ready, payroll-incomplete, ID expired,
 * thin profile, reliability flags, paused/inactive/archived statuses.
 *
 *   npx tsx scripts/smoke-chef-inzetbaarheid.mts
 */
import type { InzetbaarheidInput } from "@/lib/domain/chef-inzetbaarheid";

const { computeChefInzetbaarheid } = await import(
  "@/lib/domain/chef-inzetbaarheid"
);

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${msg}`);
  }
}

const READY: InzetbaarheidInput = {
  status: "active",
  onboardingMissingCritical: [],
  idExpired: false,
  idExpiringSoon: false,
  profileScore: 100,
  noShowCount: 0,
  churnLevel: "none",
};

// ---- ready: green light, nothing outstanding ----------------------------
{
  const v = computeChefInzetbaarheid(READY);
  ok(v.level === "ready", "fully ready → level ready");
  ok(v.headline === "Inzetbaar", "ready → headline Inzetbaar");
  ok(v.blockers.length === 0, "ready → no blockers");
  ok(v.warnings.length === 0, "ready → no warnings");
}

// ---- blocked: missing payroll essentials --------------------------------
{
  const v = computeChefInzetbaarheid({
    ...READY,
    status: "onboarding",
    onboardingMissingCritical: ["BSN", "IBAN", "ID-kopie"],
    profileScore: 40,
  });
  ok(v.level === "blocked", "missing payroll essentials → blocked");
  ok(v.headline === "Niet inzetbaar", "blocked → headline Niet inzetbaar");
  ok(v.blockers.includes("Ontbreekt: BSN"), "BSN surfaced as blocker");
  ok(v.blockers.includes("Ontbreekt: IBAN"), "IBAN surfaced as blocker");
  ok(v.blockers.includes("Ontbreekt: ID-kopie"), "ID-kopie surfaced as blocker");
  // onboarding-status warning is suppressed while hard blockers exist
  ok(
    !v.warnings.some((w) => w.includes("onboarding")),
    "onboarding nag suppressed when blocked",
  );
}

// ---- blocked: ID expired (even if everything else is fine) --------------
{
  const v = computeChefInzetbaarheid({ ...READY, idExpired: true });
  ok(v.level === "blocked", "expired ID → blocked");
  ok(v.blockers.includes("ID-bewijs verlopen"), "expired ID is a blocker");
}

// ---- blocked: inactive / archived statuses ------------------------------
{
  const inactive = computeChefInzetbaarheid({ ...READY, status: "inactive" });
  ok(inactive.level === "blocked", "inactive status → blocked");
  ok(inactive.blockers.includes("Status: inactief"), "inactive blocker label");

  const archived = computeChefInzetbaarheid({ ...READY, status: "archived" });
  ok(archived.level === "blocked", "archived status → blocked");
  ok(archived.blockers.includes("Gearchiveerd"), "archived blocker label");
}

// ---- almost: deployable but flagged -------------------------------------
{
  // still in onboarding but payroll-complete → almost (not blocked)
  const onboarding = computeChefInzetbaarheid({ ...READY, status: "onboarding" });
  ok(onboarding.level === "almost", "onboarding+complete → almost");
  ok(
    onboarding.warnings.some((w) => w.includes("onboarding")),
    "onboarding warning present when not blocked",
  );

  // ID expiring soon
  const expiring = computeChefInzetbaarheid({ ...READY, idExpiringSoon: true });
  ok(expiring.level === "almost", "ID expiring soon → almost");
  ok(
    expiring.warnings.includes("ID-bewijs verloopt binnenkort"),
    "ID-expiring warning",
  );

  // thin profile
  const thin = computeChefInzetbaarheid({ ...READY, profileScore: 55 });
  ok(thin.level === "almost", "thin profile → almost");
  ok(
    thin.warnings.includes("Profiel 55% compleet"),
    "thin-profile warning carries the score",
  );

  // reliability: no-shows + churn
  const flaky = computeChefInzetbaarheid({
    ...READY,
    noShowCount: 2,
    churnLevel: "elevated",
  });
  ok(flaky.level === "almost", "no-shows/churn → almost");
  ok(flaky.warnings.includes("2 no-shows in historie"), "no-show count pluralised");
  ok(flaky.warnings.includes("Verhoogd afhaakrisico"), "elevated churn warning");

  const oneNoShow = computeChefInzetbaarheid({ ...READY, noShowCount: 1 });
  ok(
    oneNoShow.warnings.includes("1 no-show in historie"),
    "single no-show is singular",
  );

  // paused
  const paused = computeChefInzetbaarheid({ ...READY, status: "paused" });
  ok(paused.level === "almost", "paused → almost");
  ok(paused.warnings.includes("Chef is gepauzeerd"), "paused warning label");

  // churn 'watch'
  const watch = computeChefInzetbaarheid({ ...READY, churnLevel: "watch" });
  ok(watch.warnings.includes("Activiteit loopt terug"), "watch churn warning");
}

// ---- precedence: blockers win over warnings -----------------------------
{
  const v = computeChefInzetbaarheid({
    ...READY,
    status: "inactive",
    profileScore: 50,
    noShowCount: 3,
  });
  ok(v.level === "blocked", "any blocker forces blocked even with warnings");
  ok(v.blockers.length > 0 && v.warnings.length > 0, "both lists populated");
}

console.log(`\nchef-inzetbaarheid smoke: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
