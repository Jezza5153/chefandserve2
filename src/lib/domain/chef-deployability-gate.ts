/**
 * Compliance hard-gate (P3a) — the async side of the deployability check used at the
 * propose call site. The PURE blocker logic + the DeployabilityGate type live in
 * chef-inzetbaarheid.ts (single source of truth, db-free, unit-tested); this module
 * only does the I/O: gather a chef's status + onboarding-readiness signals and run
 * evaluateChefBlockers. Reuses the EXACT readiness inputs (CHEF_COLS/readinessFor) the
 * chef-detail verdict card uses, so the gate and the card can never disagree.
 *
 * Fail-closed: an unknown/missing chef is treated as NOT deployable. Labels only
 * (field names like "Ontbreekt: BSN"), never the underlying PII values (AVG).
 *
 * The BLOCK-vs-OVERRIDE decision belongs to the caller (proposePlacement) — this only
 * computes the verdict.
 */
import { and, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefDocuments, chefs } from "@/lib/db/schema";
import { CHEF_COLS, readinessFor, type ChefRow } from "@/lib/ai/read-model/onboarding";
import { evaluateChefBlockers, type DeployabilityGate } from "@/lib/domain/chef-inzetbaarheid";

export type { DeployabilityGate } from "@/lib/domain/chef-inzetbaarheid";

const NOT_FOUND: DeployabilityGate = { deployable: false, blockers: ["Chef niet gevonden"] };

/**
 * Deployability verdict for many chefs in 2 queries (chef rows + their docs).
 * Returns a Map keyed by chefId; ids with no row map to fail-closed NOT_FOUND.
 */
export async function assertChefsDeployable(chefIds: string[]): Promise<Map<string, DeployabilityGate>> {
  const out = new Map<string, DeployabilityGate>();
  const ids = [...new Set(chefIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const rows = (await db
    .select({ ...CHEF_COLS, status: chefs.status })
    .from(chefs)
    .where(inArray(chefs.id, ids))) as (ChefRow & { status: unknown })[];

  const docs = await db
    .select({ chefId: chefDocuments.chefId, type: chefDocuments.type })
    .from(chefDocuments)
    .where(and(inArray(chefDocuments.chefId, ids), isNull(chefDocuments.deletedAt)));
  const byChef = new Map<string, Set<string>>();
  for (const d of docs) {
    let set = byChef.get(d.chefId);
    if (!set) byChef.set(d.chefId, (set = new Set()));
    set.add(d.type);
  }

  for (const c of rows) {
    const r = readinessFor(c, byChef.get(c.id) ?? new Set());
    out.set(
      c.id,
      evaluateChefBlockers({
        status: String(c.status ?? ""),
        onboardingMissingCritical: r.missingCritical,
        idExpired: r.idExpired,
      }),
    );
  }
  for (const id of ids) if (!out.has(id)) out.set(id, NOT_FOUND);
  return out;
}

/** Deployability verdict for one chef. Fail-closed if the chef is gone. */
export async function assertChefDeployable(chefId: string): Promise<DeployabilityGate> {
  const m = await assertChefsDeployable([chefId]);
  return m.get(chefId) ?? NOT_FOUND;
}
