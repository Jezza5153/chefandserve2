/**
 * Phase 3 gate — LIVE integration smoke. Proves the dark-launched compliance + margin
 * gates actually work END-TO-END against the DB (not just the unit smokes), so the owner
 * can flip the prod flags with confidence. Creates throwaway fixtures (a client, a shift,
 * an ARCHIVED chef = always 'blocked'), exercises the real domain fns with the flags ON,
 * asserts the block / override / audit chain at PROPOSE and CONFIRM, then cleans up.
 *
 * Run with the flags forced ON (inline env wins over --env-file; dotenv never overrides):
 *   COMPLIANCE_HARDGATE_ENABLED=true MATCHING_MARGIN_GUARD_ENABLED=true \
 *     npx tsx --env-file=.env.local scripts/smoke-p3-gate-integration.ts
 *
 * Fixtures use null emails so no notification/email is ever sent (best-effort + no
 * recipients). .ts (not .mts) because it imports the db client.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { auditLog, chefs, clients, placements, shifts, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { proposePlacement } from "@/lib/domain/matching";
import { transitionPlacement } from "@/lib/domain/placement-transition";
import { assertChefDeployable } from "@/lib/domain/chef-deployability-gate";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log("  ✓", name); pass++; }
  else { console.log("  ✗", name, detail ? `— ${detail}` : ""); fail++; }
}

async function auditCount(resourceId: string, action: string, phase?: string): Promise<number> {
  const rows = await db
    .select({ after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.resourceId, resourceId), eq(auditLog.action, action)));
  return phase ? rows.filter((r) => (r.after as { phase?: string } | null)?.phase === phase).length : rows.length;
}

async function main() {
  console.log("=== Phase 3 gate — live integration smoke ===\n");
  console.log("flags:",
    "COMPLIANCE_HARDGATE_ENABLED=" + env.COMPLIANCE_HARDGATE_ENABLED,
    "MATCHING_MARGIN_GUARD_ENABLED=" + env.MATCHING_MARGIN_GUARD_ENABLED);

  const flagOn = env.COMPLIANCE_HARDGATE_ENABLED === "true";

  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) { console.error("no users on this DB"); process.exit(1); }
  const userId = u.id;

  let clientId = "";
  let shiftId = "";
  let chefId = "";
  let placementId = "";
  try {
    [{ id: clientId }] = await db.insert(clients).values({ companyName: "__SMOKE_P3_CLIENT__", email: null }).returning({ id: clients.id });
    [{ id: chefId }] = await db.insert(chefs).values({ fullName: "__SMOKE_P3_ARCHIVED__", status: "archived", email: null, userId: null }).returning({ id: chefs.id });
    const start = new Date(Date.now() + 7 * 864e5);
    const end = new Date(start.getTime() + 8 * 3_600_000);
    [{ id: shiftId }] = await db.insert(shifts).values({ clientId, roleNeeded: "sous_chef", startsAt: start, endsAt: end }).returning({ id: shifts.id });

    // assertChefDeployable is a PURE read — independent of the flag; archived = blocked.
    const gate = await assertChefDeployable(chefId);
    assert("assertChefDeployable(archived) → not deployable", gate.deployable === false);
    assert("assertChefDeployable → blocker 'Gearchiveerd'", gate.blockers.includes("Gearchiveerd"), gate.blockers.join(","));

    // ---- FLAG OFF: dark-launch inertness — the gate must NOT fire ----
    if (!flagOn) {
      const r = await proposePlacement(shiftId, chefId, { proposedBy: userId });
      assert("flag OFF: archived chef proposes (gate inert)", r.status === "proposed", r.status);
      placementId = "placementId" in r ? r.placementId : "";
      const acc = await transitionPlacement({ placementId, newStatus: "accepted", actorUserId: userId, expectedStatus: "proposed" });
      assert("flag OFF: accept ok", acc.ok === true && acc.changed === true);
      const c = await transitionPlacement({ placementId, newStatus: "confirmed", actorUserId: userId, expectedStatus: "accepted" });
      assert("flag OFF: archived chef CONFIRMS (gate inert)", c.ok === true && "changed" in c && c.changed === true, JSON.stringify(c));
      assert("flag OFF: no compliance_override audit written", (await auditCount(placementId, "placements.compliance_override")) === 0);
    } else {
    // ---- FLAG ON ----
    // 2. proposePlacement (no override) → blocked, NO placement created.
    const r1 = await proposePlacement(shiftId, chefId, { proposedBy: userId });
    assert("propose blocked chef (no override) → status 'blocked'", r1.status === "blocked");
    const after2 = await db.select({ id: placements.id }).from(placements).where(and(eq(placements.shiftId, shiftId), eq(placements.chefId, chefId)));
    assert("propose blocked → no placement row written", after2.length === 0, "rows=" + after2.length);

    // 3. proposePlacement WITH compliance + margin overrides → proposed + both audits.
    const r2 = await proposePlacement(shiftId, chefId, {
      proposedBy: userId,
      override: { overriddenBy: userId, reason: "smoke: compliance override reason ok" },
      marginOverride: { overriddenBy: userId, reason: "smoke: margin override deliberate loss" },
    });
    assert("propose with override → status 'proposed'", r2.status === "proposed", r2.status);
    placementId = "placementId" in r2 ? r2.placementId : "";
    assert("propose with override → placementId returned", Boolean(placementId));
    assert("compliance_override audit (phase propose) written", (await auditCount(placementId, "placements.compliance_override", "propose")) >= 1);
    assert("margin_override audit (phase propose) written", (await auditCount(placementId, "placements.margin_override", "propose")) >= 1);

    // 4. accept (ungated) → ok+changed.
    const acc = await transitionPlacement({ placementId, newStatus: "accepted", actorUserId: userId, expectedStatus: "proposed" });
    assert("transition → accepted (ungated) ok+changed", acc.ok === true && acc.changed === true);

    // 5. confirm WITHOUT override → blocked (the financial-commit gate).
    const c1 = await transitionPlacement({ placementId, newStatus: "confirmed", actorUserId: userId, expectedStatus: "accepted" });
    assert("confirm blocked chef (no override) → ok:false reason:'blocked'", c1.ok === false && c1.reason === "blocked", JSON.stringify(c1));
    const stillAccepted = await db.select({ status: placements.status }).from(placements).where(eq(placements.id, placementId));
    assert("confirm blocked → placement NOT confirmed (still accepted)", stillAccepted[0]?.status === "accepted", stillAccepted[0]?.status);

    // 6. confirm WITH override → confirmed + confirm-phase audit.
    const c2 = await transitionPlacement({ placementId, newStatus: "confirmed", actorUserId: userId, expectedStatus: "accepted", override: { overriddenBy: userId, reason: "smoke: confirm override reason ok" } });
    assert("confirm with override → ok+changed", c2.ok === true && "changed" in c2 && c2.changed === true, JSON.stringify(c2));
    assert("compliance_override audit (phase confirm) written", (await auditCount(placementId, "placements.compliance_override", "confirm")) >= 1);
    const confirmed = await db.select({ status: placements.status }).from(placements).where(eq(placements.id, placementId));
    assert("confirm with override → placement is confirmed", confirmed[0]?.status === "confirmed", confirmed[0]?.status);
    }
  } finally {
    // Cleanup — order respects FKs; audit rows for this placement go too.
    if (placementId) await db.delete(auditLog).where(eq(auditLog.resourceId, placementId)).catch(() => {});
    if (shiftId) await db.delete(placements).where(eq(placements.shiftId, shiftId)).catch(() => {});
    if (shiftId) await db.delete(shifts).where(eq(shifts.id, shiftId)).catch(() => {});
    if (chefId) await db.delete(chefs).where(eq(chefs.id, chefId)).catch(() => {});
    if (clientId) await db.delete(clients).where(eq(clients.id, clientId)).catch(() => {});
    console.log("\n(cleaned up fixtures)");
  }

  console.log(`\n=== ${pass} passed, ${fail} failed (flag ${flagOn ? "ON" : "OFF"}) ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
