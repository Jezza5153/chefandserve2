/**
 * Personal reminder tools — Maarten's own "to-remember" list. risk "self" (changes only
 * his own state, so no confirmation) for create/complete; "read" for list. permission null
 * because it's the owner's own data, not an RBAC-gated resource (the channel is owner-only).
 */
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import {
  completeOwnerReminder,
  createOwnerReminder,
  listOwnerReminders,
} from "@/lib/ai/read-model/owner-reminders";

export const remindersCreate = defineTool({
  name: "reminders.create",
  title: "Herinnering toevoegen",
  description:
    "Zet een persoonlijke herinnering op Maarten's lijst (bijv. 'bel chef Daniel maandag'). Optioneel met een datum/tijd (ISO). Eigen lijst — geen bevestiging nodig.",
  risk: "self",
  permission: null,
  input: z.object({
    body: z.string().min(1, "Waar moet ik je aan herinneren?"),
    dueAt: z.string().optional(),
  }),
  run: async (input, ctx) => {
    const r = await createOwnerReminder({
      userId: ctx.actor.requestedByUserId,
      body: input.body,
      dueAt: input.dueAt ?? null,
      id: randomUUID(),
      now: new Date().toISOString(),
    });
    return {
      data: { id: r.id },
      summary: `Genoteerd: "${r.body}"${r.dueAt ? ` (${r.dueAt})` : ""}.`,
    };
  },
});

export const remindersList = defineTool({
  name: "reminders.list",
  title: "Herinneringen tonen",
  description:
    "Toont Maarten's openstaande persoonlijke herinneringen (of inclusief afgevinkte met includeDone). Read-only.",
  risk: "read",
  permission: null,
  input: z.object({ includeDone: z.boolean().optional() }),
  run: async (input, ctx) => {
    const items = await listOwnerReminders(ctx.actor.requestedByUserId, {
      includeDone: input.includeDone ?? false,
    });
    return {
      data: { count: items.length, reminders: items },
      summary: items.length ? `${items.length} herinnering(en) op je lijst.` : "Je lijst is leeg.",
    };
  },
});

export const remindersComplete = defineTool({
  name: "reminders.complete",
  title: "Herinnering afvinken",
  description:
    "Vinkt een persoonlijke herinnering af (klaar). Geef het id van de herinnering (uit reminders.list).",
  risk: "self",
  permission: null,
  input: z.object({ id: z.string().min(1, "id is verplicht") }),
  run: async (input, ctx) => {
    const ok = await completeOwnerReminder({
      userId: ctx.actor.requestedByUserId,
      id: input.id,
      now: new Date().toISOString(),
    });
    return {
      data: { id: input.id, completed: ok },
      summary: ok ? "Afgevinkt." : "Die herinnering kon ik niet vinden.",
    };
  },
});
