/**
 * Per-employee settings (Cockpit Instellingen hub). PR-1.7.
 *
 * `user_settings.prefs` is a generic jsonb of sections; this module owns the
 * `roster` section (feeds the roster intelligence helpers + the default view).
 * Code defaults (`DEFAULT_ROSTER_SETTINGS`) apply when a key is absent, so a
 * brand-new employee just gets sensible behaviour. Notification toggles live in
 * `notification_prefs` (see integrations/prefs.ts) — the Meldingen section uses
 * those; this stays generic so new sections need no migration.
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { auditLog, userSettings } from "@/lib/db/schema";
import { DEFAULT_ROSTER_SETTINGS, type RosterSettings } from "@/lib/roster-format";

export type RosterView = "week" | "month";

/** What an employee may store for the roster section (all optional → defaults). */
export type StoredRosterSettings = {
  criticalHours?: number;
  defaultView?: RosterView;
  labels?: Partial<RosterSettings["labels"]>;
};

/** Resolved roster settings = defaults + stored overrides; ready for the helpers. */
export type ResolvedRosterSettings = RosterSettings & { defaultView: RosterView };

type PrefsShape = { roster?: StoredRosterSettings } & Record<string, unknown>;

async function loadPrefs(userId: string): Promise<PrefsShape> {
  const [row] = await db
    .select({ prefs: userSettings.prefs })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return ((row?.prefs as PrefsShape) ?? {}) as PrefsShape;
}

/** Resolve the employee's roster settings (defaults applied for anything unset). */
export async function getRosterSettings(userId: string): Promise<ResolvedRosterSettings> {
  const r = (await loadPrefs(userId)).roster ?? {};
  const criticalHours =
    typeof r.criticalHours === "number" && r.criticalHours > 0
      ? r.criticalHours
      : DEFAULT_ROSTER_SETTINGS.criticalHours;
  return {
    criticalHours,
    labels: { ...DEFAULT_ROSTER_SETTINGS.labels, ...r.labels },
    defaultView: r.defaultView === "month" ? "month" : "week",
  };
}

/** Merge a patch into the employee's roster settings + audit. */
export async function saveRosterSettings(args: {
  userId: string;
  patch: StoredRosterSettings;
}): Promise<void> {
  const prefs = await loadPrefs(args.userId);
  const next: PrefsShape = {
    ...prefs,
    roster: { ...(prefs.roster ?? {}), ...args.patch },
  };
  await db
    .insert(userSettings)
    .values({ userId: args.userId, prefs: next as never })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { prefs: next as never, updatedAt: new Date() },
    });
  await db.insert(auditLog).values({
    userId: args.userId,
    action: "user_settings.updated",
    resource: "user_settings",
    resourceId: args.userId,
    after: { section: "roster", patch: args.patch },
  });
}
