"use server";

/**
 * Owner-agenda actions (P2-finish/P2d) — manual one-off events + their intake/prep
 * checklist. Gated on cockpit.read (the dashboard-area gate, same as this page's
 * rotateSecret). Every write audits with the actor and revalidates the agenda; the
 * create/status actions redirect back with a ?done= flash. neon-http: the domain fns
 * are single atomic statements (status transitions reject double-submits).
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/permissions";
import { recordAuditFromRequest } from "@/lib/audit";
import {
  createAgendaEvent,
  setAgendaEventStatus,
  toggleChecklistItem,
  parseChecklist,
  isAgendaEventKind,
} from "@/lib/domain/agenda-events";

const AGENDA = "/admin/business/agenda";

/** Preserve the active lens/view when redirecting back so the flash lands in context. */
function backTo(formData: FormData, done: string): string {
  const params = new URLSearchParams();
  const view = String(formData.get("view") ?? "").trim();
  const client = String(formData.get("lensClient") ?? "").trim();
  const chef = String(formData.get("lensChef") ?? "").trim();
  if (view) params.set("view", view);
  if (client) params.set("client", client);
  if (chef) params.set("chef", chef);
  params.set("done", done);
  return AGENDA + "?" + params.toString();
}

/** Create a manual agenda event (intake call / follow-up / onboarding task / …). */
export async function createAgendaEventAction(formData: FormData) {
  const session = await requirePermission("cockpit", "read");

  const type = String(formData.get("type") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const startsRaw = String(formData.get("startsAt") ?? "").trim();
  const endsRaw = String(formData.get("endsAt") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const linkedClientId = String(formData.get("linkedClientId") ?? "").trim() || null;
  const linkedChefId = String(formData.get("linkedChefId") ?? "").trim() || null;
  const checklist = parseChecklist(String(formData.get("checklist") ?? ""));

  if (!isAgendaEventKind(type) || !title || !startsRaw) {
    return redirect(backTo(formData, "agenda-onvolledig"));
  }
  const startsAt = new Date(startsRaw);
  if (Number.isNaN(startsAt.getTime())) return redirect(backTo(formData, "agenda-onvolledig"));
  const endsAt = endsRaw ? new Date(endsRaw) : null;

  const row = await createAgendaEvent({
    type,
    title,
    startsAt,
    endsAt: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt : null,
    notes,
    linkedClientId,
    linkedChefId,
    checklist,
    createdBy: session.user.id,
  });

  await recordAuditFromRequest({
    userId: session.user.id,
    action: "agenda_event.created",
    resource: "agenda_event",
    resourceId: row.id,
    after: { type, title, startsAt: startsAt.toISOString() },
  }).catch(() => {});

  redirect(backTo(formData, "agenda-aangemaakt"));
}

/** Mark a manual event done (atomic — a double-submit is a clean no-op). */
export async function completeAgendaEventAction(formData: FormData) {
  const session = await requirePermission("cockpit", "read");
  const id = String(formData.get("eventId") ?? "").trim();
  if (!id) throw new Error("eventId ontbreekt");

  const row = await setAgendaEventStatus(id, "done");
  if (row) {
    await recordAuditFromRequest({
      userId: session.user.id,
      action: "agenda_event.completed",
      resource: "agenda_event",
      resourceId: id,
    }).catch(() => {});
  }
  redirect(backTo(formData, row ? "agenda-afgerond" : "agenda-ongewijzigd"));
}

/** Cancel (hide) a manual event. */
export async function cancelAgendaEventAction(formData: FormData) {
  const session = await requirePermission("cockpit", "read");
  const id = String(formData.get("eventId") ?? "").trim();
  if (!id) throw new Error("eventId ontbreekt");

  const row = await setAgendaEventStatus(id, "cancelled");
  if (row) {
    await recordAuditFromRequest({
      userId: session.user.id,
      action: "agenda_event.cancelled",
      resource: "agenda_event",
      resourceId: id,
    }).catch(() => {});
  }
  redirect(backTo(formData, row ? "agenda-geannuleerd" : "agenda-ongewijzigd"));
}

/** Toggle one intake/prep checklist item. Revalidates in place (no flash). */
export async function toggleChecklistItemAction(formData: FormData) {
  await requirePermission("cockpit", "read");
  const id = String(formData.get("eventId") ?? "").trim();
  const index = Number(formData.get("index"));
  if (!id || !Number.isInteger(index)) throw new Error("eventId/index ontbreekt");

  await toggleChecklistItem(id, index);
  revalidatePath(AGENDA);
}
