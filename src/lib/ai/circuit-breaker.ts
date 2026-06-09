/**
 * AI circuit breaker — DB-backed (serverless has no memory between invocations), stored in
 * business_settings['ai_breaker'] like the usage tally (no migration).
 *
 * 3 consecutive provider failures within 10 min → breaker opens for 5 min: chat routes answer
 * with a friendly "storing, probeer zo weer" WITHOUT calling OpenAI (no error-hammering, no
 * burned retries), and Maarten gets a throttled notification. Any success resets the count.
 * Every helper fails OPEN (a breaker hiccup must never block the assistant itself).
 */
import { and, eq, gt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { businessSettings, notifications, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createNotification } from "@/lib/integrations/notifications";

const KEY = "ai_breaker";
const TRIP_AFTER = 3; // consecutive failures…
const WINDOW_MS = 10 * 60_000; // …within this window…
const COOLDOWN_MS = 5 * 60_000; // …open the breaker this long.

type BreakerBag = { fails: number; lastFailAt: number | null; openUntil: number | null };

function readBag(value: unknown): BreakerBag {
  const v = (value ?? {}) as Partial<BreakerBag>;
  return {
    fails: typeof v.fails === "number" ? v.fails : 0,
    lastFailAt: typeof v.lastFailAt === "number" ? v.lastFailAt : null,
    openUntil: typeof v.openUntil === "number" ? v.openUntil : null,
  };
}

async function load(): Promise<BreakerBag> {
  const [row] = await db
    .select({ value: businessSettings.value })
    .from(businessSettings)
    .where(eq(businessSettings.key, KEY))
    .limit(1);
  return readBag(row?.value);
}

async function save(bag: BreakerBag): Promise<void> {
  await db
    .insert(businessSettings)
    .values({ key: KEY, value: bag })
    .onConflictDoUpdate({ target: businessSettings.key, set: { value: bag, updatedAt: new Date() } });
}

/** True → skip the LLM call and answer with the storing-message. Fails open. */
export async function breakerOpen(now = Date.now()): Promise<boolean> {
  try {
    const bag = await load();
    return bag.openUntil != null && bag.openUntil > now;
  } catch {
    return false;
  }
}

/** Reset after a healthy run — only writes when there was something to reset. */
export async function recordAiSuccess(): Promise<void> {
  try {
    const bag = await load();
    if (bag.fails === 0 && bag.openUntil == null) return;
    await save({ fails: 0, lastFailAt: null, openUntil: null });
  } catch {
    // best-effort
  }
}

/** Count a provider failure; trip + notify (throttled) when the threshold is hit. */
export async function recordAiFailure(now = Date.now()): Promise<void> {
  try {
    const bag = await load();
    const inWindow = bag.lastFailAt != null && now - bag.lastFailAt < WINDOW_MS;
    const fails = (inWindow ? bag.fails : 0) + 1;
    const tripped = fails >= TRIP_AFTER;
    await save({
      fails,
      lastFailAt: now,
      openUntil: tripped ? now + COOLDOWN_MS : bag.openUntil,
    });
    if (tripped) void notifyBreakerTripped().catch(() => {});
  } catch {
    // best-effort
  }
}

/** Tell Maarten the assistant is degraded — max one notification per 20h. */
async function notifyBreakerTripped(): Promise<void> {
  if (!env.MAARTEN_EMAIL) return;
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, env.MAARTEN_EMAIL)).limit(1);
  if (!owner) return;
  const since = new Date(Date.now() - 20 * 60 * 60 * 1000);
  const recent = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, owner.id), eq(notifications.type, "ai_breaker_alert"), gt(notifications.createdAt, since)))
    .limit(1);
  if (recent.length > 0) return;
  await createNotification({
    userId: owner.id,
    type: "ai_breaker_alert",
    title: "AI-assistent tijdelijk gepauzeerd",
    body: "De AI-provider gaf meerdere fouten achter elkaar; de assistent pauzeert een paar minuten en herstelt daarna vanzelf. Houdt dit aan? Check /admin/system.",
    actionUrl: "/admin/system",
  });
}
