/**
 * Notification routing — PR-F1.
 *
 * Decouples "what triggered the email" from "who receives it". Admin can
 * edit recipients per event in /admin/system/notifications without a
 * redeploy.
 *
 * routeFor(event) is the only public function. 60-second in-memory cache
 * keeps it cheap to call from hot paths (every Jotform webhook, every
 * worker run). Env-var fallback ensures behavior is unchanged on first
 * deploy before any rows are written.
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { notificationRoutes } from "@/lib/db/schema";

export type NotificationEvent =
  | "chef_submission_received"
  | "client_submission_received"
  | "client_portal_request"
  | "weekly_digest"
  | "error_critical"
  | "totp_lockout"
  | "erasure_r2_failure"
  // PR-CHEF-1 — hours chain
  | "hours_signed"
  | "hours_klant_timeout"
  | "hours_admin_force_approve_needed"
  // PR-AVG-1 — privacy request received (portal or off-portal intake)
  | "privacy_request";

type Route = {
  recipients: string[];
  enabled: boolean;
  cachedAt: number;
};

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<NotificationEvent, Route>();

/** Defaults read from env. Used when no DB row exists for the event. */
function envFallback(event: NotificationEvent): string[] {
  const maarten = process.env.MAARTEN_EMAIL?.trim().toLowerCase();
  const jezza = process.env.JEZZA_EMAIL?.trim().toLowerCase();
  switch (event) {
    case "chef_submission_received":
    case "client_submission_received":
    case "client_portal_request":
    case "weekly_digest":
    case "hours_signed":
    case "hours_klant_timeout":
    case "hours_admin_force_approve_needed":
      return maarten ? [maarten] : [];
    case "error_critical":
    case "totp_lockout":
    case "erasure_r2_failure":
      return jezza ? [jezza] : [];
    case "privacy_request":
      // Legally sensitive + super_admin-fulfilled → tell both the operator
      // (awareness) and the super_admin (who actions it).
      return [maarten, jezza].filter((e): e is string => Boolean(e));
  }
}

/**
 * Resolve the recipients + enabled status for an event.
 *
 * - Cache hit (60s TTL) → return cached.
 * - DB row exists → return its recipients/enabled (case where admin edited).
 * - No row → env fallback, enabled=true.
 */
export async function routeFor(event: NotificationEvent): Promise<Route> {
  const now = Date.now();
  const cached = cache.get(event);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return cached;
  }

  const [row] = await db
    .select({
      recipients: notificationRoutes.recipients,
      enabled: notificationRoutes.enabled,
    })
    .from(notificationRoutes)
    .where(eq(notificationRoutes.event, event))
    .limit(1);

  const route: Route = row
    ? { recipients: row.recipients, enabled: row.enabled, cachedAt: now }
    : { recipients: envFallback(event), enabled: true, cachedAt: now };

  cache.set(event, route);
  return route;
}

/** Invalidate the cache for a specific event (or all). Used by the admin UI. */
export function invalidateCache(event?: NotificationEvent): void {
  if (event) cache.delete(event);
  else cache.clear();
}

/**
 * Helper used by call sites: returns recipients ONLY when the route is
 * enabled, else empty array. Caller skips send when empty.
 */
export async function recipientsFor(event: NotificationEvent): Promise<string[]> {
  const r = await routeFor(event);
  return r.enabled ? r.recipients : [];
}

export const ALL_EVENTS: NotificationEvent[] = [
  "chef_submission_received",
  "client_submission_received",
  "client_portal_request",
  "weekly_digest",
  "error_critical",
  "totp_lockout",
  "erasure_r2_failure",
  "hours_signed",
  "hours_klant_timeout",
  "hours_admin_force_approve_needed",
  "privacy_request",
];

export const EVENT_LABELS: Record<NotificationEvent, string> = {
  chef_submission_received: "Nieuwe chef-aanmelding (Jotform)",
  client_submission_received: "Nieuwe klant-aanvraag (Jotform)",
  client_portal_request: "Klant dient verzoek in via portaal",
  weekly_digest: "Weekoverzicht (maandag 08:00)",
  error_critical: "Kritieke fout in systeem",
  totp_lockout: "Te veel mislukte 2FA pogingen",
  erasure_r2_failure: "Right-to-erasure R2 cleanup faalde",
  hours_signed: "Klant heeft uren ondertekend — keuren?",
  hours_klant_timeout: "Klant heeft 5 dagen niet getekend",
  hours_admin_force_approve_needed: "Klant 10 dagen overtijd — admin actie nodig",
  privacy_request: "Privacyverzoek ontvangen (AVG)",
};
