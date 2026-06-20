/**
 * Owner-side chef contact corrections (AI reality-audit gap #6) — "de telefoon van Daniel is
 * verkeerd, zet 'm op 06-…". Scoped to the SAFE, owner-correctable basics (phone, name, city);
 * AVG-sensitive fields (BSN/IBAN/ID) and vakniveau/rate are deliberately NOT here. One verb,
 * one function: the AI tool chefs.update_contact wraps this. Atomic + audited.
 */
import { and, eq, isNull } from "drizzle-orm";

import { recordAuditFromRequest } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";

export type UpdateChefContactArgs = {
  chefId: string;
  editorUserId: string;
  phone?: string;
  fullName?: string;
  city?: string;
};
export type UpdateChefContactResult =
  | { ok: true; chefId: string; changed: string[] }
  | { ok: false; error: string };

export async function updateChefContact(args: UpdateChefContactArgs): Promise<UpdateChefContactResult> {
  const [chef] = await db
    .select({ phone: chefs.phone, fullName: chefs.fullName, city: chefs.city })
    .from(chefs)
    .where(and(eq(chefs.id, args.chefId), isNull(chefs.deletedAt)))
    .limit(1);
  if (!chef) return { ok: false, error: "Deze chef bestaat niet (meer)." };

  const set: Record<string, unknown> = {};
  const changed: string[] = [];
  if (args.phone !== undefined) {
    const v = args.phone.trim() || null;
    if (v !== chef.phone) {
      set.phone = v;
      changed.push("telefoon");
    }
  }
  if (args.fullName !== undefined) {
    const v = args.fullName.trim();
    if (v && v !== chef.fullName) {
      set.fullName = v;
      changed.push("naam");
    }
  }
  if (args.city !== undefined) {
    const v = args.city.trim() || null;
    if (v !== chef.city) {
      set.city = v;
      changed.push("stad");
    }
  }
  if (changed.length === 0) return { ok: true, chefId: args.chefId, changed };

  await db.update(chefs).set({ ...set, updatedAt: new Date() }).where(eq(chefs.id, args.chefId));
  await recordAuditFromRequest({
    userId: args.editorUserId,
    action: "chefs.contact_updated",
    resource: "chefs",
    resourceId: args.chefId,
    after: { changed },
  });
  return { ok: true, chefId: args.chefId, changed };
}
