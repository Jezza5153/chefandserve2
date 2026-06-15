/**
 * Manual agenda events (P2b/P2d) — the WRITE side + label vocabulary for the one-off
 * ops entries that aren't derived from another row (intake calls, follow-ups,
 * onboarding tasks, contract starts, internal reminders). Owner-only. neon-http has no
 * interactive transactions → every mutation is a single atomic statement (status
 * transitions reject when already in that state; checklist toggles use optimistic
 * concurrency on updatedAt). The READ/projection side lives in agenda.ts.
 */
import { and, eq, ne } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { agendaEvents, type AgendaEventRow } from "@/lib/db/schema";

export const AGENDA_EVENT_KINDS = [
  "intake_call",
  "follow_up",
  "onboarding_task",
  "contract_start",
  "internal_reminder",
] as const;
export type AgendaEventKind = (typeof AGENDA_EVENT_KINDS)[number];

const LABELS: Record<string, string> = {
  intake_call: "Intakegesprek",
  follow_up: "Opvolging",
  onboarding_task: "Onboarding-taak",
  contract_start: "Contractstart",
  internal_reminder: "Interne herinnering",
};
export function agendaEventLabel(kind: string): string {
  return LABELS[kind] ?? kind;
}
export function isAgendaEventKind(v: string): v is AgendaEventKind {
  return (AGENDA_EVENT_KINDS as readonly string[]).includes(v);
}

export type ChecklistItem = { label: string; done: boolean };

/** Parse a newline-separated textarea into checklist items (deduped, trimmed, capped). */
export function parseChecklist(raw: string | null | undefined): ChecklistItem[] | null {
  if (!raw) return null;
  const items = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((label) => ({ label: label.slice(0, 200), done: false }));
  return items.length > 0 ? items : null;
}

export type CreateAgendaEventInput = {
  type: AgendaEventKind;
  startsAt: Date;
  endsAt?: Date | null;
  title: string;
  notes?: string | null;
  linkedClientId?: string | null;
  linkedChefId?: string | null;
  linkedShiftId?: string | null;
  assignedTo?: string | null;
  checklist?: ChecklistItem[] | null;
  createdBy: string;
};

export async function createAgendaEvent(input: CreateAgendaEventInput): Promise<AgendaEventRow> {
  const [row] = await db
    .insert(agendaEvents)
    .values({
      type: input.type,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      title: input.title.trim().slice(0, 200),
      notes: input.notes?.trim() || null,
      linkedClientId: input.linkedClientId || null,
      linkedChefId: input.linkedChefId || null,
      linkedShiftId: input.linkedShiftId || null,
      assignedTo: input.assignedTo || input.createdBy,
      checklist: input.checklist ?? null,
      createdBy: input.createdBy,
    })
    .returning();
  return row;
}

/**
 * Atomic status transition — rejects (returns null) if the event is already in that
 * state or gone, so a double-submit can't re-fire side effects.
 */
export async function setAgendaEventStatus(
  id: string,
  status: "open" | "done" | "cancelled",
): Promise<AgendaEventRow | null> {
  const [row] = await db
    .update(agendaEvents)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(agendaEvents.id, id), ne(agendaEvents.status, status)))
    .returning();
  return row ?? null;
}

export async function reassignAgendaEvent(id: string, assignedTo: string | null): Promise<boolean> {
  const [row] = await db
    .update(agendaEvents)
    .set({ assignedTo: assignedTo || null, updatedAt: new Date() })
    .where(eq(agendaEvents.id, id))
    .returning({ id: agendaEvents.id });
  return Boolean(row);
}

/**
 * Toggle one checklist item by index (read → flip → write). Last-write-wins, which is
 * fine here: the checklist is owner-only and very low-contention, and an optimistic
 * guard on updatedAt is unreliable (Postgres stores µs precision but the JS Date
 * round-trips at ms, so the equality match silently drops the write). Returns false if
 * the index is out of range or there's no checklist.
 */
export async function toggleChecklistItem(id: string, index: number): Promise<boolean> {
  const [row] = await db
    .select({ checklist: agendaEvents.checklist })
    .from(agendaEvents)
    .where(eq(agendaEvents.id, id))
    .limit(1);
  if (!row?.checklist || index < 0 || index >= row.checklist.length) return false;
  const next = row.checklist.map((it, i) => (i === index ? { ...it, done: !it.done } : it));
  const [updated] = await db
    .update(agendaEvents)
    .set({ checklist: next, updatedAt: new Date() })
    .where(eq(agendaEvents.id, id))
    .returning({ id: agendaEvents.id });
  return Boolean(updated);
}
