"use server";

import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/permissions";
import { createSavedSearch, deleteSavedSearch } from "@/lib/domain/saved-searches";

/** B2: pin the current chef-search filters as a one-click button. Owner = session, never form. */
export async function saveCurrentSearch(formData: FormData) {
  const session = await requirePermission("chefs", "read");
  const label = String(formData.get("label") ?? "").trim();
  const query = String(formData.get("query") ?? "").trim().replace(/^\?/, "");
  if (!label) {
    redirect(`/admin/business/chefs${query ? `?${query}` : ""}`);
  }
  const res = await createSavedSearch({ ownerUserId: session.user.id, label, query });
  const base = `/admin/business/chefs?${query ? `${query}&` : ""}saved=${res.ok ? "ok" : "mislukt"}`;
  redirect(base);
}

/** B2: remove one of the owner's saved-search buttons (auth-scoped in the domain). */
export async function removeSavedSearch(formData: FormData) {
  const session = await requirePermission("chefs", "read");
  const id = String(formData.get("id") ?? "").trim();
  const query = String(formData.get("query") ?? "").trim().replace(/^\?/, "");
  if (id) await deleteSavedSearch(id, session.user.id);
  redirect(`/admin/business/chefs${query ? `?${query}` : ""}`);
}
