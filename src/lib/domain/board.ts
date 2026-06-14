/**
 * Communal board ("Prikbord", BOARD-1). Owner/team author; chefs read + react.
 * Authoring is RBAC-gated (board.write) at the route; boardEnabled() gates the
 * chef-facing feed + the new-post fan-out (so the owner can prepare posts before
 * going live). Free-text body is DATA — always escaped on render, never fed to AI.
 */
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db } from "@/lib/db/client";
import {
  boardPostImages,
  boardPosts,
  boardReactions,
  chefs,
  type BoardPost,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createNotificationsFanOut, enqueueIntegrationEvent } from "@/lib/integrations";
import { boardImageKey, getDownloadUrl, getUploadUrl, isAllowedFile } from "@/lib/r2";

/** The fixed emoji palette chefs can react with (keeps it tidy + abuse-resistant). */
export const BOARD_EMOJI = ["👍", "❤️", "🔥", "👏", "😂"] as const;
export type BoardEmoji = (typeof BOARD_EMOJI)[number];

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

/* ----- chef feed (read + react + images) — BOARD-2 ------------------------- */

export type FeedReaction = { emoji: string; count: number; mine: boolean };
export type FeedPost = {
  id: string;
  body: string;
  pinned: boolean;
  createdAt: Date;
  imageUrls: string[];
  reactions: FeedReaction[];
};

/**
 * The chef-facing feed: non-deleted posts whose audience includes chefs,
 * pinned-first then newest. Reaction counts (+ whether the viewer reacted) and
 * images are resolved via GROUPED queries + Maps — never a per-post projection
 * subquery (drizzle+neon-http renders those uncorrelated → always 0).
 */
export async function listBoardFeed(args: {
  userId: string;
  limit?: number;
}): Promise<FeedPost[]> {
  const posts = await db
    .select()
    .from(boardPosts)
    .where(and(isNull(boardPosts.deletedAt), inArray(boardPosts.audience, ["chefs", "all"])))
    .orderBy(desc(boardPosts.pinned), desc(boardPosts.createdAt))
    .limit(args.limit ?? 50);
  if (posts.length === 0) return [];
  const ids = posts.map((p) => p.id);

  // Reaction counts + viewer's own reactions, grouped.
  const reactRows = await db
    .select({
      postId: boardReactions.postId,
      emoji: boardReactions.emoji,
      count: sql<number>`count(*)::int`,
      mine: sql<boolean>`bool_or(${boardReactions.userId} = ${args.userId})`,
    })
    .from(boardReactions)
    .where(inArray(boardReactions.postId, ids))
    .groupBy(boardReactions.postId, boardReactions.emoji);
  const reactByPost = new Map<string, FeedReaction[]>();
  for (const r of reactRows) {
    const arr = reactByPost.get(r.postId) ?? [];
    arr.push({ emoji: r.emoji, count: Number(r.count), mine: Boolean(r.mine) });
    reactByPost.set(r.postId, arr);
  }

  // Images, grouped → presigned GET per key.
  const imgRows = await db
    .select({ postId: boardPostImages.postId, r2Key: boardPostImages.r2Key })
    .from(boardPostImages)
    .where(inArray(boardPostImages.postId, ids));
  const imgByPost = new Map<string, string[]>();
  for (const i of imgRows) {
    const url = await getDownloadUrl(i.r2Key).catch(() => null);
    if (!url) continue;
    const arr = imgByPost.get(i.postId) ?? [];
    arr.push(url);
    imgByPost.set(i.postId, arr);
  }

  return posts.map((p) => ({
    id: p.id,
    body: p.body,
    pinned: p.pinned,
    createdAt: p.createdAt,
    imageUrls: imgByPost.get(p.id) ?? [],
    reactions: reactByPost.get(p.id) ?? [],
  }));
}

/** Idempotent toggle: react if not present, un-react if present. Fixed palette only. */
export async function toggleReaction(args: {
  postId: string;
  userId: string;
  emoji: string;
}): Promise<{ ok: boolean }> {
  if (!BOARD_EMOJI.includes(args.emoji as BoardEmoji)) return { ok: false };
  const [existing] = await db
    .select({ id: boardReactions.id })
    .from(boardReactions)
    .where(
      and(
        eq(boardReactions.postId, args.postId),
        eq(boardReactions.userId, args.userId),
        eq(boardReactions.emoji, args.emoji),
      ),
    )
    .limit(1);
  if (existing) {
    await db.delete(boardReactions).where(eq(boardReactions.id, existing.id));
  } else {
    await db
      .insert(boardReactions)
      .values({ postId: args.postId, userId: args.userId, emoji: args.emoji })
      .onConflictDoNothing();
  }
  return { ok: true };
}

/* ----- new-post fan-out (in-app + phone push) — BOARD-3 -------------------- */

/** Active chefs with a portal account — the audience for a new-post ping. */
async function activeChefUserIds(): Promise<string[]> {
  const rows = await db
    .select({ userId: chefs.userId })
    .from(chefs)
    .where(and(eq(chefs.status, "active"), isNotNull(chefs.userId)));
  return rows.map((r) => r.userId).filter((x): x is string => Boolean(x));
}

/**
 * Announce a fresh board post: an in-app bell row per active chef (one bulk
 * insert, best-effort) + ONE web_push outbox event (idempotency key per post)
 * that the deliver-push worker fans out to phones. No-op unless boardEnabled().
 * Free-text excerpt is escaped on render + never fed to AI.
 */
export async function announceBoardPost(args: { postId: string; body: string }): Promise<void> {
  if (!boardEnabled()) return;
  const userIds = await activeChefUserIds();
  if (userIds.length === 0) return;
  const excerpt = args.body.trim().slice(0, 120) + (args.body.trim().length > 120 ? "…" : "");

  await createNotificationsFanOut(userIds, {
    type: "board_new_post",
    title: "Nieuw op het prikbord",
    body: excerpt,
    actionUrl: "/chef/board",
    entityType: "board_post",
    entityId: args.postId,
  });

  try {
    await enqueueIntegrationEvent({
      provider: "web_push",
      eventType: "board.new_post",
      entityType: "board_post",
      entityId: args.postId,
      payload: {
        userIds,
        title: "Nieuw op het prikbord",
        body: excerpt,
        url: "/chef/board",
        type: "board_new_post",
      },
      idempotencyKey: `board.new_post:${args.postId}`,
    });
  } catch (err) {
    console.error("[board] push fan-out enqueue failed:", err instanceof Error ? err.message : "unknown");
  }
}

/** Admin: presign an image upload for an existing post (browser PUTs directly to R2). */
export async function requestBoardImageUpload(args: {
  postId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<{ ok: true; uploadUrl: string } | { ok: false; error: string }> {
  const guard = isAllowedFile(args.mimeType, args.sizeBytes);
  if (!guard.ok) return { ok: false, error: guard.reason };
  if (!args.mimeType.startsWith("image/")) return { ok: false, error: "Alleen afbeeldingen." };
  const imageId = randomUUID();
  const key = boardImageKey(args.postId, imageId, args.filename);
  await db.insert(boardPostImages).values({
    postId: args.postId,
    r2Key: key,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
  });
  const { url } = await getUploadUrl(key, args.mimeType);
  return { ok: true, uploadUrl: url };
}
