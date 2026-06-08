/**
 * Profile-change read-model — the queue of chef-submitted profile changes awaiting an
 * owner's decision. Mirrors the admin chef-detail join; read-only. Backs the
 * assistant's chefs.list_profile_changes tool (which pairs with approve/reject).
 */
import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, profileChangeRequests } from "@/lib/db/schema";
import {
  chefChangeFieldLabel,
  formatChefChangeValue,
} from "@/lib/chef-profile-change-labels";

/** Chef profile-change requests still waiting on the owner (status 'pending'). */
export async function listPendingProfileChanges() {
  const rows = await db
    .select({
      requestId: profileChangeRequests.id,
      chefId: profileChangeRequests.chefId,
      chefName: chefs.fullName,
      field: profileChangeRequests.field,
      currentValue: profileChangeRequests.currentValue,
      proposedValue: profileChangeRequests.proposedValue,
      reason: profileChangeRequests.reason,
      requestedAt: profileChangeRequests.createdAt,
    })
    .from(profileChangeRequests)
    .innerJoin(chefs, eq(chefs.id, profileChangeRequests.chefId))
    .where(eq(profileChangeRequests.status, "pending"))
    .orderBy(asc(profileChangeRequests.createdAt))
    .limit(200);

  // Pre-format the field + values so the brain gets human-readable text, not raw
  // cents/enum codes (the read-model's "no raw backend values" intent).
  return rows.map((r) => ({
    ...r,
    fieldLabel: chefChangeFieldLabel(r.field),
    currentLabel: formatChefChangeValue(r.field, r.currentValue),
    proposedLabel: formatChefChangeValue(r.field, r.proposedValue),
  }));
}

export type PendingProfileChange = Awaited<
  ReturnType<typeof listPendingProfileChanges>
>[number];
