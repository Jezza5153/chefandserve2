/**
 * CHEF-PR11 smoke — i18n foundation integrity (pure, no DB).
 * Run: npx tsx scripts/smoke-i18n.ts
 *
 * The TS compiler already pins en.ts to the nl.ts shape, but this guards at
 * runtime too: NL/EN have IDENTICAL leaf keys, every leaf is a non-empty string,
 * getDict falls back to NL, and asLocale narrows unknown input to 'nl'.
 */
import { nl } from "../src/lib/i18n/dictionaries/nl";
import { en } from "../src/lib/i18n/dictionaries/en";
import { getDict } from "../src/lib/i18n/get-dict";
import { asLocale, DEFAULT_LOCALE, LOCALES } from "../src/lib/i18n/locales";

let failed = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failed++;
};

/** Collect dotted leaf paths of a nested string dictionary. */
function leafPaths(obj: unknown, prefix = ""): string[] {
  if (typeof obj === "string") return [prefix];
  if (obj && typeof obj === "object") {
    return Object.entries(obj).flatMap(([k, v]) =>
      leafPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [];
}

const nlKeys = leafPaths(nl).sort();
const enKeys = leafPaths(en).sort();

ok(nlKeys.length > 0, `NL dictionary has ${nlKeys.length} leaf keys`);
ok(
  JSON.stringify(nlKeys) === JSON.stringify(enKeys),
  "NL and EN have identical leaf keys",
);

const missingInEn = nlKeys.filter((k) => !enKeys.includes(k));
const extraInEn = enKeys.filter((k) => !nlKeys.includes(k));
if (missingInEn.length) console.log("  missing in EN:", missingInEn.join(", "));
if (extraInEn.length) console.log("  extra in EN:", extraInEn.join(", "));

/** every leaf is a non-empty trimmed string in both dictionaries */
function getAt(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], obj);
}
const allNonEmpty = [...nlKeys].every((k) => {
  const a = getAt(nl, k);
  const b = getAt(en, k);
  return typeof a === "string" && a.trim() !== "" && typeof b === "string" && b.trim() !== "";
});
ok(allNonEmpty, "every leaf is a non-empty string in NL and EN");

ok(getDict("nl") === nl, "getDict('nl') returns the NL dictionary");
ok(getDict("en") === en, "getDict('en') returns the EN dictionary");
// @ts-expect-error — deliberately pass a bad locale to prove the fallback
ok(getDict("fr") === nl, "getDict(unknown) falls back to NL");

ok(asLocale("en") === "en", "asLocale('en') === 'en'");
ok(asLocale("nl") === "nl", "asLocale('nl') === 'nl'");
ok(asLocale("fr") === "nl", "asLocale('fr') falls back to 'nl'");
ok(asLocale(undefined) === "nl", "asLocale(undefined) falls back to 'nl'");
ok(DEFAULT_LOCALE === "nl" && LOCALES.length === 2, "default locale nl, 2 locales");

ok(en.nav.today === "Today" && nl.nav.today === "Vandaag", "nav.today translates NL→EN");

console.log(failed === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
