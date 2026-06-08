/**
 * Chef deep-dive read-model — the assistant's window into a single chef's real track
 * record + feedback. Wraps the hardened Chef-360 domain readers (chef-history.ts) so the
 * AI answers "is Daniel betrouwbaar / hoeveel heeft hij verdiend / wat zeggen klanten" with
 * the SAME audited numbers the admin chef page shows — no fabrication. Enum codes are
 * humanised through labels.ts so the brain gets readable Dutch, not raw values.
 *
 * Ratings are internal-only V1; the owner (admin) sees the full picture — these tools are
 * owner-gated (chefs.read), so that's correct.
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import { getChefWorkSummary, getChefFeedbackSummary } from "@/lib/domain/chef-history";
import { buildChefTrends } from "@/lib/domain/chef-trends";
import { getChefDailySeries } from "@/lib/domain/metrics-history";
import { formatChefRole, formatSegment, formatClientType } from "@/lib/labels";

/** id → name/role/status, or null if the chef doesn't exist. */
async function loadChef(chefId: string) {
  const [chef] = await db
    .select({
      id: chefs.id,
      fullName: chefs.fullName,
      vakniveau: chefs.vakniveau,
      status: chefs.status,
      city: chefs.city,
    })
    .from(chefs)
    .where(eq(chefs.id, chefId))
    .limit(1);
  return chef ?? null;
}

export async function chefWorkSummary(chefId: string) {
  const chef = await loadChef(chefId);
  if (!chef) return null;
  const s = await getChefWorkSummary(chefId);
  return {
    chef: {
      id: chef.id,
      name: chef.fullName,
      vakniveau: formatChefRole(chef.vakniveau),
      status: chef.status,
      city: chef.city,
    },
    totalHoursWorked: s.totalHoursWorked,
    completedShifts: s.completedShifts,
    upcomingShifts: s.upcomingShifts,
    reliability: {
      proposed: s.proposedCount,
      accepted: s.acceptedCount,
      declined: s.declinedCount,
      cancelled: s.cancelledCount,
      noShow: s.noShowCount,
    },
    averageRating: s.averageRating,
    ratingCount: s.ratingCount,
    lastWorkedAt: s.lastWorkedAt,
    topClients: s.topClients,
    topSegments: s.topSegments.map((x) => ({ segment: formatSegment(x.segment), count: x.count })),
    topClientTypes: s.topClientTypes.map((x) => ({ clientType: formatClientType(x.clientType), count: x.count })),
  };
}

export type ChefWorkSummary = NonNullable<Awaited<ReturnType<typeof chefWorkSummary>>>;

export async function chefFeedback(chefId: string) {
  const chef = await loadChef(chefId);
  if (!chef) return null;
  const fb = await getChefFeedbackSummary(chefId);
  return {
    chef: { id: chef.id, name: chef.fullName },
    recent: fb.recent,
    topTags: fb.topTags,
  };
}

export type ChefFeedback = NonNullable<Awaited<ReturnType<typeof chefFeedback>>>;

/**
 * Trend + churn-risk signals (last ~13 weeks of snapshots). Drops the raw sparkline
 * arrays — the brain reasons over the churn label, week-over-week deltas and rates, not
 * the visual. Churn level + reasons are deterministic + explainable (never a magic score).
 */
export async function chefTrends(chefId: string) {
  const chef = await loadChef(chefId);
  if (!chef) return null;
  const t = buildChefTrends(await getChefDailySeries(chefId, 90));
  return {
    chef: { id: chef.id, name: chef.fullName },
    churn: t.churn,
    daysSinceLastWorked: t.daysSinceLastWorked,
    ratingAvg28d: t.ratingAvg28d,
    acceptanceRate28d: t.acceptanceRate28d,
    hasEnoughHistory: t.hasEnoughHistory,
    deltas7d: { hours: t.hoursDelta, marginEur: t.marginDelta, completedShifts: t.shiftsDelta },
  };
}

export type ChefTrendsView = NonNullable<Awaited<ReturnType<typeof chefTrends>>>;
