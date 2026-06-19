/**
 * CHEF-PR1 — chef → klant preferences ("stuur mij hier liever niet meer heen" +
 * favourites). The chef tells us how they feel about a klant; matching soft-scores
 * it (never a hard exclude). INTERNAL — klanten never see it. One row per (chef,
 * klant); clearing a preference deletes the row.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefClientPrefs } from "@/lib/db/schema";

export type ChefClientPrefKind =
  | "favourite"
  | "block"
  | "only_emergency"
  | "only_better_brief"
  | "only_higher_rate";

/** Picker vocabulary (chef-facing Dutch). Shared by the UI + server validation. */
export const CHEF_CLIENT_PREF_OPTIONS: { key: ChefClientPrefKind; label: string }[] = [
  { key: "favourite", label: "Graag weer hierheen" },
  { key: "only_emergency", label: "Alleen bij spoed" },
  { key: "only_better_brief", label: "Alleen met betere briefing" },
  { key: "only_higher_rate", label: "Alleen tegen hoger tarief" },
  { key: "block", label: "Liever niet meer hierheen" },
];

const PREF_KEYS = new Set(CHEF_CLIENT_PREF_OPTIONS.map((o) => o.key));

/** Narrow a raw form value to a valid pref key (else null). */
export function asChefClientPref(raw: string): ChefClientPrefKind | null {
  return PREF_KEYS.has(raw as ChefClientPrefKind) ? (raw as ChefClientPrefKind) : null;
}

export function chefClientPrefLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  return CHEF_CLIENT_PREF_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

/**
 * Set (upsert) or clear a chef's preference for a klant. `pref === null` deletes
 * the row ("geen voorkeur"). Ownership is the caller's responsibility (pass the
 * session-resolved chefId — never a form id).
 */
export async function setChefClientPref(args: {
  chefId: string;
  clientId: string;
  pref: ChefClientPrefKind | null;
}): Promise<{ ok: boolean }> {
  if (!args.chefId || !args.clientId) return { ok: false };
  if (args.pref === null) {
    await db
      .delete(chefClientPrefs)
      .where(
        and(eq(chefClientPrefs.chefId, args.chefId), eq(chefClientPrefs.clientId, args.clientId)),
      );
    return { ok: true };
  }
  await db
    .insert(chefClientPrefs)
    .values({ chefId: args.chefId, clientId: args.clientId, pref: args.pref })
    .onConflictDoUpdate({
      target: [chefClientPrefs.chefId, chefClientPrefs.clientId],
      set: { pref: args.pref, updatedAt: new Date() },
    });
  return { ok: true };
}

/** The chef's current preference for one klant (null = none). */
export async function getChefClientPref(
  chefId: string,
  clientId: string,
): Promise<ChefClientPrefKind | null> {
  const [row] = await db
    .select({ pref: chefClientPrefs.pref })
    .from(chefClientPrefs)
    .where(and(eq(chefClientPrefs.chefId, chefId), eq(chefClientPrefs.clientId, clientId)))
    .limit(1);
  return (row?.pref as ChefClientPrefKind | undefined) ?? null;
}

/**
 * Batch: every candidate chef's preference for ONE klant (for matching). One
 * query; returns Map<chefId, pref>. Absent chef = no preference.
 */
export async function getClientPrefsForChefs(
  clientId: string,
  chefIds: string[],
): Promise<Map<string, ChefClientPrefKind>> {
  const out = new Map<string, ChefClientPrefKind>();
  if (chefIds.length === 0) return out;
  const rows = await db
    .select({ chefId: chefClientPrefs.chefId, pref: chefClientPrefs.pref })
    .from(chefClientPrefs)
    .where(and(eq(chefClientPrefs.clientId, clientId), inArray(chefClientPrefs.chefId, chefIds)));
  for (const r of rows) out.set(r.chefId, r.pref as ChefClientPrefKind);
  return out;
}
