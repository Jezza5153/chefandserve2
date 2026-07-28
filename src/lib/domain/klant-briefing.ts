/**
 * The practical half of a klant's notes, made safe to show a chef.
 *
 * 28 of 47 klanten have parking details in `clients.notes` and 20 have a dress code, all
 * of it migrated from the old system and all of it invisible to the people who need it:
 * a chef standing outside a hotel at 06:30 has no idea which entrance to use.
 *
 * WHY THIS IS NOT JUST "SHOW THE NOTES".
 *
 * The notes blob is the owner's internal judgment layer. It quotes conflicts, names other
 * klanten, records what someone charges and why a chef is blacklisted — which is why the
 * dossier tools are owner-surface-only and why `placements.notes` is never read for
 * klant-facing answers. Piping that to chefs would leak all of it.
 *
 * So this SUGGESTS and a human ACCEPTS. The extractor finds candidate lines; the owner
 * promotes one into a structured, chef-visible field with a click. One decision per field,
 * and nothing crosses the boundary that a person did not put there.
 *
 * The suggestions are only ever suggestions: a line that looks like parking information
 * can still mention a rate, so the promotion screen shows the full line and the owner
 * edits before saving.
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients } from "@/lib/db/schema";

export type BriefingVeld = "arrivalInstructions" | "parkingInfo" | "dressCodeDefault" | "bringAlong";

export const BRIEFING_LABEL: Record<BriefingVeld, string> = {
  arrivalInstructions: "Aankomst & melden",
  parkingInfo: "Parkeren",
  dressCodeDefault: "Kleding",
  bringAlong: "Meenemen",
};

/** What a chef is told this field is, in their own words. */
export const BRIEFING_CHEF_LABEL: Record<BriefingVeld, string> = {
  arrivalInstructions: "Waar meld je je",
  parkingInfo: "Parkeren",
  dressCodeDefault: "Wat draag je",
  bringAlong: "Wat neem je mee",
};

/**
 * Words that mark a line as being ABOUT a field.
 *
 * BILINGUAL on purpose: the old system's briefings were written in Dutch and English side
 * by side, often within one klant. A Dutch-only list filed "Preferably white chef jacket
 * (black ok). NO private parking" under parking, because "jacket" was invisible and
 * "parking" was not — the line is plainly about the jacket.
 *
 * Kept generous otherwise. A missed suggestion costs a scroll through the notes; an
 * irrelevant one costs a glance, because nothing is saved until someone reads it.
 */
const SIGNAAL: Record<BriefingVeld, RegExp> = {
  arrivalInstructions:
    /\b(aankomst|melden|meld je|ingang|entree|receptie|achteringang|personeelsingang|aanmelden|badge|sleutel|arrival|report to|reception|entrance|staff entrance|check in)\b/i,
  parkingInfo:
    /\b(parkeer\w*|parking|garage|slagboom|parkeerplaats|car park)\b/i,
  dressCodeDefault:
    /\b(kleding|uniform\w*|jas|koksbuis|schort|zwarte broek|schoenen|dresscode|dress code|nette|jacket|chef jacket|apron|shoes|black trousers|whites)\b/i,
  bringAlong:
    /\b(meenemen|eigen messen|messenset|meebrengen|neem mee|zelf meenemen|knives|own knives|bring your own|bring along)\b/i,
};

/**
 * Lines that must never be offered, whatever else they contain.
 *
 * A line about money or about another person is not arrival information, and offering it
 * makes it one click from a chef's screen. Cheaper to drop a useful line than to leak one.
 */
const NOOIT = /(tarief|€|eur\b|uurloon|factuur|betaal|marge|korting|blacklist|niet meer welkom|klacht|conflict|ruzie|ontslag)/i;

export type BriefingVoorstel = {
  veld: BriefingVeld;
  regel: string;
  /** The note's own date, when it carries one — a 2022 parking rule may not hold. */
  datum: string | null;
};

/** Candidate lines from this klant's notes, per field. Reads only; changes nothing. */
export function voorstellenUitNotities(notes: string | null): BriefingVoorstel[] {
  if (!notes?.trim()) return [];
  const uit: BriefingVoorstel[] = [];
  const gezien = new Set<string>();

  for (const ruw of notes.split("\n")) {
    const regel = ruw.replace(/^[•\-*\s]+/, "").trim();
    if (regel.length < 12 || regel.length > 400) continue;
    if (NOOIT.test(regel)) continue;

    const datum =
      regel.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ??
      regel.match(/\b(\d{2}\/\d{2}\/\d{4})\b/)?.[1] ??
      null;

    // One line, ONE field — decided by which signal appears FIRST, because a sentence
    // leads with its subject. Counting matches instead rewards repetition: "Preferably
    // white chef jacket (black ok). NO private parking; only OV covered" says "parking"
    // twice and is filed under parking, when it is plainly about the jacket.
    let beste: { veld: BriefingVeld; positie: number } | null = null;
    for (const veld of Object.keys(SIGNAAL) as BriefingVeld[]) {
      const positie = regel.search(SIGNAAL[veld]);
      if (positie < 0) continue;
      if (!beste || positie < beste.positie) beste = { veld, positie };
    }
    if (!beste) continue;

    const sleutel = `${beste.veld}:${regel.slice(0, 60)}`;
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);
    // Strip the old system's "13 | 05/08/2022 | " prefix — it is metadata, not briefing.
    const schoon = regel.replace(/^\d+\s*\|\s*[\d/]+\s*\|\s*/, "").replace(/^Briefing \(oud\):\s*(Info\s*\|\s*)?/i, "").trim();
    uit.push({ veld: beste.veld, regel: schoon, datum });
  }
  return uit;
}

export type KlantBriefing = {
  arrivalInstructions: string | null;
  parkingInfo: string | null;
  dressCodeDefault: string | null;
  bringAlong: string | null;
};

export async function getKlantBriefing(clientId: string): Promise<KlantBriefing | null> {
  const [r] = (await db
    .select({
      arrivalInstructions: clients.arrivalInstructions,
      parkingInfo: clients.parkingInfo,
      dressCodeDefault: clients.dressCodeDefault,
      bringAlong: clients.bringAlong,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)) as KlantBriefing[];
  return r ?? null;
}

/** Anything filled in at all? Surfaces use this to stay quiet rather than show four dashes. */
export function heeftBriefing(b: KlantBriefing | null): boolean {
  return !!b && Object.values(b).some((v) => !!v?.trim());
}

/** As chef-facing lines, in the order someone reads them before leaving home. */
export function briefingRegels(b: KlantBriefing | null): { label: string; tekst: string }[] {
  if (!b) return [];
  const volgorde: BriefingVeld[] = ["arrivalInstructions", "parkingInfo", "dressCodeDefault", "bringAlong"];
  return volgorde
    .filter((v) => b[v]?.trim())
    .map((v) => ({ label: BRIEFING_CHEF_LABEL[v], tekst: b[v]!.trim() }));
}

export async function setKlantBriefingVeld(clientId: string, veld: BriefingVeld, waarde: string | null): Promise<void> {
  await db
    .update(clients)
    .set({ [veld]: waarde?.trim() || null, updatedAt: new Date() })
    .where(eq(clients.id, clientId));
}

export async function getNotities(clientId: string): Promise<string | null> {
  const [r] = (await db.select({ notes: clients.notes }).from(clients).where(eq(clients.id, clientId)).limit(1)) as { notes: string | null }[];
  return r?.notes ?? null;
}
