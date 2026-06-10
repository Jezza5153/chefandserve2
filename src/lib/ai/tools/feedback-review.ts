/**
 * feedback.review — the assistant reads its own report card. Surfaces the 👍/👎 feedback
 * (counts + the actual recent downvotes) so Maarten can ask "wat ging er mis deze week?"
 * and decide what to teach (memory.remember) or what to flag for a playbook tweak.
 */
import { z } from "zod";

import { getAiFeedbackSummary } from "@/lib/ai/read-model/ai-feedback-summary";
import { defineTool } from "@/lib/ai/tools/registry";

export const feedbackReview = defineTool({
  name: "feedback.review",
  title: "AI-feedback terugkijken",
  description:
    "Hoe beoordeelde het team mijn antwoorden (👍/👎)? Telling over de afgelopen periode + de recente 👎-gevallen zelf (vraag + antwoord-fragment), zodat je ziet WAT er misging en kunt bijsturen (onthouden via memory.remember, of een playbook-aanpassing voorstellen). Optioneel `windowDays` (default 30). Read-only.",
  risk: "read",
  permission: { resource: "cockpit", action: "read" },
  input: z.object({ windowDays: z.number().int().min(1).max(120).optional() }),
  run: async (input) => {
    const s = await getAiFeedbackSummary({ now: new Date(), windowDays: input.windowDays });
    if (s.total === 0) {
      return {
        data: s,
        summary: `Nog geen feedback in de laatste ${s.windowDays} dagen — vraag het team 👍/👎 te gebruiken in de chat.`,
      };
    }
    const pct = Math.round((s.downRate ?? 0) * 100);
    const cases = s.recentDownvotes
      .slice(0, 3)
      .map((d) => `"${d.question.slice(0, 60)}…"`)
      .join("; ");
    return {
      data: s,
      summary: `${s.total} beoordelingen (${s.windowDays}d): ${s.up}× 👍, ${s.down}× 👎 (${pct}%).${
        s.down ? ` Recente 👎: ${cases}. Wil je dat ik hier iets van onthoud?` : " 👍"
      }`,
    };
  },
});
