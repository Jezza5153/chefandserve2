/**
 * Matching names from the OLD system against each other and against our own klanten.
 *
 * This exists because a first attempt got it wrong twice in a row, in opposite directions.
 * Substring matching ("does a klant name occur inside the legacy name") missed
 * "Renaissance Hotel Amsterdam" ↔ "Renaissance Amsterdam Hotel" purely on word order, and
 * dropped "Showw B.V." for being under seven characters — so four klanten we already serve
 * were reported to the owner as accounts still to be migrated. Loosening it far enough to
 * catch those, without care, makes the opposite error: "Holland Casino Centrum" and
 * "Holland Casino Rotterdam" share almost every word while being different venues, and
 * collapsing them would erase thousands of genuinely lost diensten from the loss list.
 *
 * So the rules here are deliberately conservative in BOTH directions:
 *
 *  1. Compare sets of distinctive words, not strings — word order and legal forms are noise.
 *  2. Require CONTAINMENT, not resemblance. Every distinctive word of the shorter name must
 *     appear in the longer one. Degree-of-overlap scoring was tried and let "Amstel Hotel
 *     Maatschappij Amsterdam" match "Van der Valk Hotel Amsterdam - Amstel" on the two words
 *     they happen to share.
 *  3. Refuse ties. If two candidates fit equally well the name is ambiguous, and seven
 *     Holland Casino venues resembling each other equally is exactly that signal.
 *  4. For succession (one entry continuing another) also require the periods to dovetail.
 *     Venues that ran side by side are siblings, not a rename — "Hangar Noord" and "Hangar
 *     Oost" look almost identical and overlap for a year, which is what tells them apart
 *     from "Hilton | Hotel Operational Company B.V. Schiphol" stopping in 2025-11 and
 *     "Hilton / Schiphol" starting there.
 *
 * Everything unresolved stays unresolved on purpose. An unmatched name means "no klant here
 * under this name" — never "lost klant". That inference is what caused the original mistake.
 */

/**
 * Words carrying no information about WHICH venue this is: legal forms, the word "hotel",
 * filler. Cities are deliberately NOT here — "Rotterdam" vs "Schiphol" is often the only
 * thing separating two branches of one chain.
 */
const NIETSZEGGEND = new Set([
  "bv", "b.v", "nv", "n.v", "vof", "cv", "the", "van", "der", "den", "het", "een",
  "hotel", "hotels", "restaurant", "horeca", "exploitatie", "beheer", "groep", "group",
  "holding", "nederland", "netherlands", "main", "com", "www",
]);

/** The distinctive words of a name, lowercased and stripped of punctuation. */
export function kenmerkendeWoorden(naam: string): Set<string> {
  return new Set(
    naam
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !NIETSZEGGEND.has(w)),
  );
}

export type Kandidaat<T> = { waarde: T; naam: string };

/**
 * Names that mean the same venue but share no spelling, verified by hand against the old
 * system. Kept tiny and explicit: an alias is a claim that two businesses are one, and that
 * claim should be readable in the diff rather than emerge from a similarity threshold.
 */
const ALIASSEN: { legacy: RegExp; klant: RegExp }[] = [
  // "Koninklijke" is simply the Dutch of "Royal" — same club, translated name.
  { legacy: /koninklijke industrieele groote club/i, klant: /royal industrieele groote club/i },
  // "Ventrua" is a typo for "Ventura" in the old system's debiteur record.
  { legacy: /art ventrua/i, klant: /art ventura/i },
];

/**
 * The one candidate that means the same venue as `naam`, or null.
 *
 * Matching is by CONTAINMENT: every distinctive word of the shorter name must appear in the
 * longer one. Scoring by degree of overlap was tried and is not safe here — "Amstel Hotel
 * Maatschappij Amsterdam" and "Van der Valk Hotel Amsterdam - Amstel" share "amstel" and
 * "amsterdam", enough to score as a match, and linking them would have credited 1.565
 * diensten of a hotel we lost to a klant we still have. Containment refuses that because
 * "maatschappij" and "valk" each appear on only one side.
 *
 * The cost is real and accepted: names that mean the same thing without sharing words
 * (translations, typos) stay unlinked unless they are in ALIASSEN. An unlinked row is
 * reported as "no klant here under this name", which is honest; a wrong link is not.
 */
export function besteMatch<T>(naam: string, kandidaten: Kandidaat<T>[]): T | null {
  for (const alias of ALIASSEN) {
    if (alias.legacy.test(naam)) {
      const treffer = kandidaten.find((k) => alias.klant.test(k.naam));
      if (treffer) return treffer.waarde;
    }
  }

  const woorden = kenmerkendeWoorden(naam);
  if (woorden.size === 0) return null;

  const passend: { waarde: T; gedeeld: number }[] = [];
  for (const k of kandidaten) {
    const kandidaatWoorden = kenmerkendeWoorden(k.naam);
    if (kandidaatWoorden.size === 0) continue;
    const gedeeld = [...woorden].filter((w) => kandidaatWoorden.has(w)).length;
    if (gedeeld === Math.min(woorden.size, kandidaatWoorden.size)) passend.push({ waarde: k.waarde, gedeeld });
  }
  if (passend.length === 0) return null;

  // Several klanten can be contained in one legacy name (a chain and one of its venues).
  // Take the most specific, and refuse when two are equally specific rather than guess.
  passend.sort((a, b) => b.gedeeld - a.gedeeld);
  if (passend.length > 1 && passend[0].gedeeld === passend[1].gedeeld) return null;
  return passend[0].waarde;
}

/** Whole months two periods share ("2023-03".."2025-11" vs "2025-11".."2026-07" → 1). */
export function maandenOverlap(aVan: string, aTot: string, bVan: string, bTot: string): number {
  const start = aVan > bVan ? aVan : bVan;
  const eind = aTot < bTot ? aTot : bTot;
  if (start > eind) return 0;
  const nr = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
  return nr(eind) - nr(start) + 1;
}

/**
 * Longer than this and the two entries ran side by side — sibling venues of one chain, not
 * one venue re-registered. A genuine re-registration dovetails: the old entry stops in the
 * month the new one starts, or there is a gap between them.
 */
const MAX_OVERLAP_MAANDEN = 2;

/**
 * Did `nieuw` take over from `oud`, rather than run alongside it?
 *
 * The name test here is deliberately stricter than `besteMatch`: one name's distinctive
 * words must be wholly contained in the other's. Mere resemblance is not enough, because
 * getting this wrong DELETES a real loss from the loss list. Scoring by overlap accepted
 * "Okura … Main Kitchen Amsterdam" as continued by "NH Krasnapolsky … Main Kitchen
 * Amsterdam" — two unrelated hotels sharing the words "kitchen" and "amsterdam" — which
 * would have quietly written off 1.035 genuinely lost diensten. Containment rejects that
 * while still accepting "Hilton | Hotel Operational Company B.V. Schiphol" → "Hilton /
 * Schiphol", where the shorter name is exactly a subset of the longer one.
 */
export function isOpvolgerVan(
  oud: { naam: string; eerste: string; laatste: string },
  nieuw: { naam: string; eerste: string; laatste: string },
): boolean {
  const a = kenmerkendeWoorden(oud.naam);
  const b = kenmerkendeWoorden(nieuw.naam);
  if (a.size === 0 || b.size === 0) return false;
  const gedeeld = [...a].filter((w) => b.has(w)).length;
  if (gedeeld < Math.min(a.size, b.size)) return false; // one must contain the other
  if (nieuw.eerste < oud.eerste) return false; // a successor cannot predate what it succeeds
  return maandenOverlap(oud.eerste, oud.laatste, nieuw.eerste, nieuw.laatste) <= MAX_OVERLAP_MAANDEN;
}
