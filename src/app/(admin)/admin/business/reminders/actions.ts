"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { recordAuditFromRequest } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { reminderRules } from "@/lib/db/schema";
import { requireAnyRole } from "@/lib/permissions";

const PATH = "/admin/business/reminders";

const TRIGGERS = [
  "chef_birthday",
  "id_document_expiry",
  "certificate_expiry",
  "chef_inactivity",
] as const;
const CHANNELS = ["email", "in_app", "both"] as const;
const ROLE_OPTS = ["owner", "planner", "super_admin"] as const;

type Trigger = (typeof TRIGGERS)[number];
type Channel = (typeof CHANNELS)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function gate() {
  return requireAnyRole(["owner", "planner"], "/admin/business");
}

function parseRecipients(raw: string): { ok: true; emails: string[] } | { ok: false } {
  const emails = raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (emails.some((e) => !EMAIL_RE.test(e))) return { ok: false };
  return { ok: true, emails: [...new Set(emails)] };
}

function readForm(fd: FormData) {
  const name = String(fd.get("name") ?? "").trim();
  const triggerType = String(fd.get("triggerType") ?? "");
  const leadDays = Math.max(0, Math.min(365, Math.round(Number(fd.get("leadDays") ?? 0)) || 0));
  const channel = String(fd.get("channel") ?? "email");
  const recipientRoles = fd
    .getAll("recipientRoles")
    .map(String)
    .filter((r) => (ROLE_OPTS as readonly string[]).includes(r));
  const notifySubjectChef = fd.get("notifySubjectChef") === "on";
  const enabled = fd.get("enabled") === "on";
  const thresholdDays = Math.round(Number(fd.get("thresholdDays") ?? 0)) || 0;
  const params = triggerType === "chef_inactivity" && thresholdDays > 0 ? { thresholdDays } : {};
  return { name, triggerType, leadDays, channel, recipientRoles, notifySubjectChef, enabled, params };
}

export async function createRule(fd: FormData) {
  const session = await gate();
  const f = readForm(fd);
  if (
    !f.name ||
    !(TRIGGERS as readonly string[]).includes(f.triggerType) ||
    !(CHANNELS as readonly string[]).includes(f.channel)
  ) {
    redirect(`${PATH}?err=invalid`);
  }
  const rec = parseRecipients(String(fd.get("recipients") ?? ""));
  if (!rec.ok) redirect(`${PATH}?err=bad-email`);

  await db.insert(reminderRules).values({
    name: f.name,
    triggerType: f.triggerType as Trigger,
    leadDays: f.leadDays,
    channel: f.channel as Channel,
    recipients: rec.emails,
    recipientRoles: f.recipientRoles,
    notifySubjectChef: f.notifySubjectChef,
    params: f.params,
    enabled: f.enabled,
    createdBy: session.user.id,
    updatedBy: session.user.id,
  });
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "reminder_rule.created",
    resource: "reminder_rules",
    resourceId: null,
    after: { name: f.name, trigger: f.triggerType },
  });
  revalidatePath(PATH);
  redirect(`${PATH}?ok=created`);
}

export async function updateRule(id: string, fd: FormData) {
  const session = await gate();
  const f = readForm(fd);
  if (
    !f.name ||
    !(TRIGGERS as readonly string[]).includes(f.triggerType) ||
    !(CHANNELS as readonly string[]).includes(f.channel)
  ) {
    redirect(`${PATH}?err=invalid`);
  }
  const rec = parseRecipients(String(fd.get("recipients") ?? ""));
  if (!rec.ok) redirect(`${PATH}?err=bad-email`);

  await db
    .update(reminderRules)
    .set({
      name: f.name,
      triggerType: f.triggerType as Trigger,
      leadDays: f.leadDays,
      channel: f.channel as Channel,
      recipients: rec.emails,
      recipientRoles: f.recipientRoles,
      notifySubjectChef: f.notifySubjectChef,
      params: f.params,
      enabled: f.enabled,
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(reminderRules.id, id));
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "reminder_rule.updated",
    resource: "reminder_rules",
    resourceId: id,
    after: { name: f.name, enabled: f.enabled },
  });
  revalidatePath(PATH);
  redirect(`${PATH}?ok=saved`);
}

export async function toggleRule(id: string) {
  const session = await gate();
  const [rule] = await db.select().from(reminderRules).where(eq(reminderRules.id, id)).limit(1);
  if (!rule) redirect(PATH);
  await db
    .update(reminderRules)
    .set({ enabled: !rule.enabled, updatedBy: session.user.id, updatedAt: new Date() })
    .where(eq(reminderRules.id, id));
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "reminder_rule.toggled",
    resource: "reminder_rules",
    resourceId: id,
    after: { enabled: !rule.enabled },
  });
  revalidatePath(PATH);
  redirect(PATH);
}

export async function deleteRule(id: string) {
  const session = await gate();
  await db.delete(reminderRules).where(eq(reminderRules.id, id));
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "reminder_rule.deleted",
    resource: "reminder_rules",
    resourceId: id,
  });
  revalidatePath(PATH);
  redirect(`${PATH}?ok=deleted`);
}
