/**
 * Placement comments — PR-KLANT-0.
 *
 * Structured, visibility-scoped, multi-actor comments. REPLACES the old
 * anti-pattern of appending klant feedback to `placements.notes` (which
 * mixed admin/matching/klant/chef scopes — a privacy leak).
 *
 * Rules (plan correction round 3, #5):
 *   - body trimmed, 1..1000 chars (DB CHECK is the backstop)
 *   - plain text only — renderers NEVER use dangerouslySetInnerHTML
 *   - reads are ownership + visibility filtered:
 *       admin  → all rows
 *       client → visibility='client_visible' (their own shift only)
 *       chef   → visibility='chef_visible' (their own placement only)
 *   - ownership is verified by the CALLER before invoking these (session →
 *     entity), never trusting an id from form data.
 */

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import { placementComments } from "@/lib/db/schema";

export type CommentAuthorKind = "client" | "admin" | "chef" | "system";
export type CommentVisibility = "internal" | "client_visible" | "chef_visible";

export type AddCommentArgs = {
  placementId: string;
  authorUserId: string | null;
  authorKind: CommentAuthorKind;
  visibility: CommentVisibility;
  body: string;
  metadata?: Record<string, unknown>;
};

export type AddCommentResult =
  | { ok: true; id: string }
  | { ok: false; error: "empty" | "too-long" | "insert-failed" };

/**
 * Insert one comment. Trims + length-validates BEFORE the DB so we return a
 * clean error instead of a 500 from the CHECK constraint.
 */
export async function addPlacementComment(
  args: AddCommentArgs,
): Promise<AddCommentResult> {
  const body = args.body.trim();
  if (body.length === 0) return { ok: false, error: "empty" };
  if (body.length > 1000) return { ok: false, error: "too-long" };

  try {
    const [row] = await db
      .insert(placementComments)
      .values({
        placementId: args.placementId,
        authorUserId: args.authorUserId,
        authorKind: args.authorKind,
        visibility: args.visibility,
        body,
        metadata: (args.metadata ?? {}) as never,
      })
      .returning({ id: placementComments.id });

    await recordAuditFromRequest({
      userId: args.authorUserId ?? undefined,
      action: "placement_comments.created",
      resource: "placement_comments",
      resourceId: row.id,
      after: {
        placementId: args.placementId,
        authorKind: args.authorKind,
        visibility: args.visibility,
      },
    });

    return { ok: true, id: row.id };
  } catch (err) {
    console.error(
      "[comments] insert failed:",
      err instanceof Error ? err.message : "unknown",
    );
    return { ok: false, error: "insert-failed" };
  }
}

/**
 * Which visibility levels a given viewer kind is allowed to read.
 * Admin sees everything; client + chef see only their own scope.
 */
function visibleScopesFor(viewerKind: CommentAuthorKind): CommentVisibility[] {
  switch (viewerKind) {
    case "admin":
      return ["internal", "client_visible", "chef_visible"];
    case "client":
      return ["client_visible"];
    case "chef":
      return ["chef_visible"];
    case "system":
      return ["internal", "client_visible", "chef_visible"];
  }
}

/**
 * List comments for a placement, filtered by the viewer's allowed
 * visibility scopes. Ownership (does this viewer own this placement /
 * shift?) MUST be verified by the caller before calling this.
 */
export async function listVisibleComments(
  placementId: string,
  viewer: { kind: CommentAuthorKind },
): Promise<(typeof placementComments.$inferSelect)[]> {
  const scopes = visibleScopesFor(viewer.kind);
  return db
    .select()
    .from(placementComments)
    .where(
      and(
        eq(placementComments.placementId, placementId),
        inArray(placementComments.visibility, scopes),
      ),
    )
    .orderBy(asc(placementComments.createdAt));
}
