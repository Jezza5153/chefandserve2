/**
 * Memory tools — Maarten teaches the assistant facts/preferences it then uses automatically
 * (they're injected into the system prompt every turn via ownerMemoryPromptBlock). risk
 * "self" for remember/forget (his own knowledge, no confirm); "read" for list. permission
 * null (owner-only channel, not an RBAC resource).
 */
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { forgetFact, listOwnerMemory, rememberFact } from "@/lib/ai/read-model/owner-memory";

export const memoryRemember = defineTool({
  name: "memory.remember",
  title: "Onthouden",
  description:
    "Onthoud een feit of voorkeur die Maarten je vertelt (bijv. 'hotel Okura wil altijd 2 koks', 'ik werk niet met bureau X'). Je gebruikt deze kennis daarna automatisch in elk antwoord. Eigen kennis — geen bevestiging nodig.",
  risk: "self",
  permission: null,
  input: z.object({ text: z.string().min(1, "Wat moet ik onthouden?") }),
  run: async (input, ctx) => {
    const f = await rememberFact({
      userId: ctx.actor.requestedByUserId,
      text: input.text,
      id: randomUUID(),
      now: new Date().toISOString(),
    });
    return { data: { id: f.id }, summary: `Onthouden: "${f.text}".` };
  },
});

export const memoryList = defineTool({
  name: "memory.list",
  title: "Onthouden kennis tonen",
  description: "Toont wat je voor Maarten onthouden hebt. Read-only.",
  risk: "read",
  permission: null,
  input: z.object({}),
  run: async (_input, ctx) => {
    const items = await listOwnerMemory(ctx.actor.requestedByUserId);
    return {
      data: { count: items.length, facts: items },
      summary: items.length ? `${items.length} ding(en) die ik onthoud.` : "Ik heb nog niets onthouden.",
    };
  },
});

export const memoryForget = defineTool({
  name: "memory.forget",
  title: "Vergeten",
  description: "Vergeet een eerder onthouden feit. Geef het id (uit memory.list).",
  risk: "self",
  permission: null,
  input: z.object({ id: z.string().min(1, "id is verplicht") }),
  run: async (input, ctx) => {
    const ok = await forgetFact({ userId: ctx.actor.requestedByUserId, id: input.id });
    return { data: { id: input.id, forgotten: ok }, summary: ok ? "Vergeten." : "Dat kon ik niet vinden." };
  },
});
