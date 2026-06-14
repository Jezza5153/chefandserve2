/**
 * Communal board ("Prikbord", BOARD-1). Owner/team author; chefs read + react.
 * Authoring is RBAC-gated (board.write) at the route; boardEnabled() gates the
 * chef-facing feed + the new-post fan-out (so the owner can prepare posts before
 * going live). Free-text body is DATA — always escaped on render, never fed to AI.
 */
import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { boardPosts, type BoardPost } from "@/lib/db/schema";
import { env } from "@/lib/env";

export type BoardAudience = "chefs" | "all";

const MAX_BODY = 4000;

/** Master switch for the chef feed + fan-out. Owner authoring works regardless. */
export function boardEnabled(): boolean {
  return env.BOARD_ENABLED === "true";
}

export async function createBoardPost(args: {
  authorId: string;
  body: string;
  pinned: boolean;
  audience: BoardAudience;
}): Promise<string | null> {
  const body = args.body.trim().slice(0, MAX_BODY);
  if (!body) return null;
  const [row] = await db
    .insert(boardPosts)
    .values({ authorId: args.authorId, body, pinned: args.pinned, audience: args.audience })
    .returning({ id: boardPosts.id });
  return row?.id ?? null;
}

/** Admin list — all non-deleted posts, pinned-first then newest. */
export async function listAdminPosts(limit = 50): Promise<BoardPost[]> {
  return db
    .select()
    .from(boardPosts)
    .where(isNull(boardPosts.deletedAt))
    .orderBy(desc(boardPosts.pinned), desc(boardPosts.createdAt))
    .limit(limit);
}

export async function softDeletePost(id: string): Promise<void> {
  await db
    .update(boardPosts)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(boardPosts.id, id), isNull(boardPosts.deletedAt)));
}

export async function setPinned(id: string, pinned: boolean): Promise<void> {
  await db
    .update(boardPosts)
    .set({ pinned, updatedAt: new Date() })
    .where(and(eq(boardPosts.id, id), isNull(boardPosts.deletedAt)));
}
