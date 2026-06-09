/**
 * GET /api/cron/onboarding-nudge — the proactive onboarding chase (AI active → proactive).
 *
 * Sweeps incomplete CHEF + CLIENT onboarding (read-model/onboarding + read-model/client-onboarding,
 * which return MISSING FIELD LABELS only — never PII), nudges each one in-app to finish, and sends
 * Maarten a "wie mist wat" summary. In-app notifications ONLY (no outbound email) — safe to
 * dark-launch. Per-user throttle (6 days) so re-runs or a manual hit never spam the same person.
 *
 * WHY app-side (not a pure Railway worker): it reuses the shared read-models behind the `@/` alias,
 * which the standalone workers/ deploy can't import (same reason as daily-briefing / rag-ingest).
 * The scheduler is a thin ticker (workers/onboarding-nudge.ts) that POSTs this endpoint weekly.
 *
 * Dark-launched: no-op unless ONBOARDING_NUDGE_ENABLED=true. Auth: Bearer CRON_SECRET (→ 401/503).
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { and, eq, gt, inArray } from "drizzle-orm";

import { sweepClientOnboarding } from "@/lib/ai/read-model/client-onboarding";
import { sweepChefOnboarding } from "@/lib/ai/read-model/onboarding";
import { db } from "@/lib/db/client";
import { chefs, clients, notifications, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createNotification } from "@/lib/integrations/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHEF_NUDGE = "onboarding_nudge";
const CLIENT_NUDGE = "client_onboarding_nudge";
const OWNER_SUMMARY = "onboarding_nudge_summary";
const THROTTLE_DAYS = 6;

function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** userIds that already received a notification of `type` within the throttle window. */
async function recentlyNudged(userIds: string[], type: string): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const since = new Date(Date.now() - THROTTLE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ userId: notifications.userId })
    .from(notifications)
    .where(
      and(
        inArray(notifications.userId, userIds),
        eq(notifications.type, type),
        gt(notifications.createdAt, since),
      ),
    );
  return new Set(rows.map((r) => r.userId));
}

export async function GET(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (!authorized(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (process.env.ONBOARDING_NUDGE_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: "disabled" }, { status: 200 });
  }

  // --- CHEFS: nudge each incomplete chef in-app (missing labels only) ---
  const chefSweep = await sweepChefOnboarding();
  let chefsNudged = 0;
  if (chefSweep.length) {
    const chefRows = await db
      .select({ id: chefs.id, userId: chefs.userId })
      .from(chefs)
      .where(inArray(chefs.id, chefSweep.map((c) => c.chefId)));
    const userByChef = new Map(chefRows.map((r) => [r.id, r.userId]));
    const targets = chefSweep
      .map((c) => userByChef.get(c.chefId))
      .filter((x): x is string => Boolean(x));
    const skip = await recentlyNudged(targets, CHEF_NUDGE);
    for (const c of chefSweep) {
      const userId = userByChef.get(c.chefId);
      if (!userId || skip.has(userId)) continue;
      const res = await createNotification({
        userId,
        type: CHEF_NUDGE,
        title: "Maak je profiel compleet",
        body: `Je mist nog: ${c.missing.join(", ")}. Vul deze aan zodat we je kunnen inplannen én uitbetalen.`,
        actionUrl: "/chef/onboarding",
        entityType: "chefs",
        entityId: c.chefId,
      });
      if (res.ok) chefsNudged++;
    }
  }

  // --- CLIENTS: nudge each incomplete klant in-app (missing labels only) ---
  const clientSweep = await sweepClientOnboarding();
  let clientsNudged = 0;
  if (clientSweep.length) {
    const clientRows = await db
      .select({ id: clients.id, userId: clients.userId })
      .from(clients)
      .where(inArray(clients.id, clientSweep.map((c) => c.clientId)));
    const userByClient = new Map(clientRows.map((r) => [r.id, r.userId]));
    const targets = clientSweep
      .map((c) => userByClient.get(c.clientId))
      .filter((x): x is string => Boolean(x));
    const skip = await recentlyNudged(targets, CLIENT_NUDGE);
    for (const c of clientSweep) {
      const userId = userByClient.get(c.clientId);
      if (!userId || skip.has(userId)) continue;
      const res = await createNotification({
        userId,
        type: CLIENT_NUDGE,
        title: "Rond je bedrijfsgegevens af",
        body: `Je mist nog: ${c.missing.join(", ")}. Vul deze aan zodat we de samenwerking goed kunnen inrichten.`,
        actionUrl: "/client/onboarding",
        entityType: "clients",
        entityId: c.clientId,
      });
      if (res.ok) clientsNudged++;
    }
  }

  // --- OWNER: a "wie mist wat" summary for Maarten (throttled like the rest) ---
  let ownerNotified = false;
  if (env.MAARTEN_EMAIL && (chefSweep.length || clientSweep.length)) {
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, env.MAARTEN_EMAIL))
      .limit(1);
    if (owner) {
      const skip = await recentlyNudged([owner.id], OWNER_SUMMARY);
      if (!skip.has(owner.id)) {
        const parts: string[] = [];
        if (chefSweep.length) parts.push(`${chefSweep.length} chef(s)`);
        if (clientSweep.length) parts.push(`${clientSweep.length} klant(en)`);
        const detail = [
          chefSweep[0] ? `minst compleet: ${chefSweep[0].chef}` : "",
          clientSweep[0] ? `klant: ${clientSweep[0].client}` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        const res = await createNotification({
          userId: owner.id,
          type: OWNER_SUMMARY,
          title: "Onboarding: openstaande gegevens",
          body: `${parts.join(" en ")} missen nog verplichte gegevens${detail ? ` (${detail})` : ""}.`,
          actionUrl: "/admin/business",
        });
        ownerNotified = res.ok;
      }
    }
  }

  return NextResponse.json(
    { ok: true, chefsNudged, clientsNudged, ownerNotified },
    { status: 200 },
  );
}
