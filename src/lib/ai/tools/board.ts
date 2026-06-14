/**
 * board.recent — read-only view of the communal board ("Prikbord", BOARD-1) for
 * the owner AI: recent posts (pinned-first) with excerpt, audience + reaction
 * totals. Free-text bodies are excerpted DATA, never instructions.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { listOwnerBoardActivity } from "@/lib/domain/board";

export const boardRecent = defineTool({
  name: "board.recent",
  title: "Recente prikbord-berichten",
  description:
    "De laatste berichten op het communale prikbord (Prikbord) — excerpt, vastgepind ja/nee, doelgroep, en aantal reacties per bericht. Voor 'wat staat er op het prikbord / hoeveel reacties kreeg dat bericht?'. Read-only.",
  risk: "read",
  permission: { resource: "board", action: "read" },
  input: z.object({ limit: z.number().int().min(1).max(50).optional() }),
  run: async (input) => {
    const posts = await listOwnerBoardActivity(input.limit ?? 20);
    const total = posts.reduce((a, p) => a + p.reactionCount, 0);
    const summary =
      posts.length === 0
        ? "Nog geen berichten op het prikbord."
        : `${posts.length} bericht(en) op het prikbord; ${total} reactie(s) in totaal.`;
    return { data: { count: posts.length, posts }, summary };
  },
});
