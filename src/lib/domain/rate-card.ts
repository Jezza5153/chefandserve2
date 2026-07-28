/**
 * The rate card: what a role SHOULD cost the klant and earn the chef.
 *
 * Until now nothing in this system knew that. Every shift's two rates were typed by hand
 * with no prefill and no norm to check against, so a slip of €34 where €43 was meant went
 * straight off the margin and showed up nowhere — there was no expected value to deviate
 * from. That silence also leaves €0 rates possible, which then propagate into invoice
 * lines and payroll as real amounts.
 *
 * Stored in `business_settings` under one key, so this needs no migration and no new
 * table: the card is a handful of numbers that change a few times a year, not a
 * transactional record. It is a NORM, never a constraint — the owner overrides per shift
 * whenever a klant has its own deal, and an override is never blocked, only remarked on.
 *
 * The stored rates are the plain hourly rates. Surcharges (night, weekend, spoed) are a
 * separate layer on top and deliberately not folded in here; folding them in is exactly
 * how the old rate became unexplainable.
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { businessSettings } from "@/lib/db/schema";
import type { vakniveauEnum } from "@/lib/db/schema";

export const RATE_CARD_KEY = "rate_card";

export type Vakniveau = (typeof vakniveauEnum)["enumValues"][number];

export type TariefNorm = {
  /** What we charge the klant, per hour, in cents. */
  klantCents: number;
  /** What the chef earns, per hour, in cents. */
  chefCents: number;
};

export type Tariefkaart = Partial<Record<Vakniveau, TariefNorm>>;

/** How far a rate may sit from the norm before we say something. */
const AFWIJKING_DREMPEL = 0.15;

export async function getTariefkaart(): Promise<Tariefkaart> {
  const [row] = (await db
    .select({ value: businessSettings.value })
    .from(businessSettings)
    .where(eq(businessSettings.key, RATE_CARD_KEY))
    .limit(1)) as { value: unknown }[];
  if (!row?.value || typeof row.value !== "object") return {};
  const kaart = row.value as Record<string, unknown>;
  const uit: Tariefkaart = {};
  for (const [rol, waarde] of Object.entries(kaart)) {
    if (!waarde || typeof waarde !== "object") continue;
    const w = waarde as { klantCents?: unknown; chefCents?: unknown };
    const klantCents = Number(w.klantCents);
    const chefCents = Number(w.chefCents);
    // A half-filled entry is worse than no entry: it would prefill one side and leave the
    // other at zero, which reads as "this role is free".
    if (!Number.isFinite(klantCents) || !Number.isFinite(chefCents)) continue;
    if (klantCents <= 0 || chefCents <= 0) continue;
    uit[rol as Vakniveau] = { klantCents: Math.round(klantCents), chefCents: Math.round(chefCents) };
  }
  return uit;
}

export async function setTariefkaart(kaart: Tariefkaart, userId: string): Promise<void> {
  await db
    .insert(businessSettings)
    .values({ key: RATE_CARD_KEY, value: kaart, updatedBy: userId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: businessSettings.key,
      set: { value: kaart, updatedBy: userId, updatedAt: new Date() },
    });
}

/** The norm for one role, or null when the card says nothing about it. */
export async function getNormVoor(rol: Vakniveau): Promise<TariefNorm | null> {
  const kaart = await getTariefkaart();
  return kaart[rol] ?? null;
}

export type TariefOordeel = {
  /** Nothing to say — either on the norm, or no norm exists for this role. */
  ok: boolean;
  /** Dutch sentence for the operator, or null when ok. */
  opmerking: string | null;
  norm: TariefNorm | null;
};

const euro = (c: number) => `€ ${(c / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Compare entered rates against the norm. NEVER blocks — a deviation is usually a real
 * deal, and the one time it is a typo the operator still wants to be the one who decides.
 */
export function beoordeelTarief(
  ingevoerd: { klantCents: number | null; chefCents: number | null },
  norm: TariefNorm | null,
): TariefOordeel {
  if (!norm) return { ok: true, opmerking: null, norm: null };

  const opmerkingen: string[] = [];
  const kijk = (label: string, waarde: number | null, normWaarde: number) => {
    if (waarde == null) return;
    if (waarde <= 0) {
      opmerkingen.push(`${label} staat op € 0,00 — de norm is ${euro(normWaarde)}`);
      return;
    }
    const afwijking = (waarde - normWaarde) / normWaarde;
    if (Math.abs(afwijking) < AFWIJKING_DREMPEL) return;
    const richting = afwijking > 0 ? "hoger" : "lager";
    opmerkingen.push(
      `${label} ${euro(waarde)} is ${Math.round(Math.abs(afwijking) * 100)}% ${richting} dan de norm ${euro(normWaarde)}`,
    );
  };
  kijk("klanttarief", ingevoerd.klantCents, norm.klantCents);
  kijk("cheftarief", ingevoerd.chefCents, norm.chefCents);

  if (opmerkingen.length === 0) return { ok: true, opmerking: null, norm };
  return {
    ok: false,
    opmerking: `${opmerkingen.join(" en ")}. Klopt dat? Je kunt gewoon doorgaan — dit is een norm, geen regel.`,
    norm,
  };
}

/** The margin a norm implies, as a percentage of the klant rate. */
export function normMarge(norm: TariefNorm): number | null {
  if (norm.klantCents <= 0) return null;
  return Math.round(((norm.klantCents - norm.chefCents) / norm.klantCents) * 100);
}
