/**
 * Business settings — PR-SET-1.
 *
 * Company-wide operational config the OWNER controls without a developer or env
 * change. KV over the `business_settings` table; `value` jsonb holds a boolean
 * flag ({"enabled":true}) today and richer settings (SLAs, rates) later. 60s
 * in-memory cache (mirrors routeFor() in notifications.ts) so hot reads are cheap.
 *
 * NOTE: Railway workers CANNOT import this (it pulls in the Next.js db client);
 * they read the same row via raw SQL — see workers/hours-reminders.ts.
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { businessSettings } from "@/lib/db/schema";

type CacheEntry = { value: Record<string, unknown>; cachedAt: number };
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, CacheEntry>();

/** Known setting keys — extend as new toggles are added. */
export const SETTING_KEYS = {
  hoursReminders: "hours_reminders",
  dailyBriefing: "daily_briefing",
} as const;

/** Raw jsonb value for a key (cached). Returns {} when no row exists. */
export async function getSetting(key: string): Promise<Record<string, unknown>> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.cachedAt < CACHE_TTL_MS) return hit.value;

  const [row] = await db
    .select({ value: businessSettings.value })
    .from(businessSettings)
    .where(eq(businessSettings.key, key))
    .limit(1);

  const value = (row?.value as Record<string, unknown>) ?? {};
  cache.set(key, { value, cachedAt: now });
  return value;
}

/** Boolean feature flag. Default FALSE (safe) when the row/flag is unset. */
export async function getFlag(key: string): Promise<boolean> {
  const v = await getSetting(key);
  return v.enabled === true;
}

/** Upsert a boolean flag + invalidate the cache. Caller records the audit row. */
export async function setFlag(
  key: string,
  enabled: boolean,
  userId: string,
): Promise<void> {
  await db
    .insert(businessSettings)
    .values({ key, value: { enabled }, updatedBy: userId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: businessSettings.key,
      set: { value: { enabled }, updatedBy: userId, updatedAt: new Date() },
    });
  cache.delete(key);
}

/** Upsert an arbitrary jsonb value (richer than a boolean flag) + invalidate the cache. */
export async function setSettingValue(
  key: string,
  value: Record<string, unknown>,
  userId: string,
): Promise<void> {
  await db
    .insert(businessSettings)
    .values({ key, value, updatedBy: userId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: businessSettings.key,
      set: { value, updatedBy: userId, updatedAt: new Date() },
    });
  cache.delete(key);
}

/** Invalidate the cache for a key (or all). */
export function invalidateSettingCache(key?: string): void {
  if (key) cache.delete(key);
  else cache.clear();
}

/* ---------- Daily briefing ("dagstart") config -------------------------- */

export type DailyBriefingConfig = {
  /** Master switch. Default OFF — Maarten opts in (so nothing emails him pre-launch). */
  enabled: boolean;
  /** Hour of day to send, 0–23, Europe/Amsterdam. The Railway ticker fires at this hour. */
  hour: number;
  /** Delivery channels. WhatsApp stays off until a Meta-approved template lands. */
  channels: { app: boolean; email: boolean; whatsapp: boolean };
  /** Optional WhatsApp recipient (E.164) — used once the template is approved. */
  whatsappTo?: string;
  /** Amsterdam day-key of the last successful send — the once-per-day dedup marker. */
  lastSentDate?: string;
};

/** Normalised daily-briefing config (defaults applied). Read by the cron + the settings UI. */
export async function getDailyBriefingConfig(): Promise<DailyBriefingConfig> {
  const v = await getSetting(SETTING_KEYS.dailyBriefing);
  const ch = (v.channels as Record<string, unknown> | undefined) ?? {};
  return {
    enabled: v.enabled === true,
    hour: typeof v.hour === "number" && v.hour >= 0 && v.hour <= 23 ? v.hour : 7,
    channels: { app: ch.app !== false, email: ch.email !== false, whatsapp: ch.whatsapp === true },
    whatsappTo: typeof v.whatsappTo === "string" ? v.whatsappTo : undefined,
    lastSentDate: typeof v.lastSentDate === "string" ? v.lastSentDate : undefined,
  };
}
