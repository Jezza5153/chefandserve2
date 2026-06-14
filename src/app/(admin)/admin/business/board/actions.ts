"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { recordAuditFromRequest } from "@/lib/audit";
import {
  createBoardPost,
  setPinned,
  softDeletePost,
  type BoardAudience,
} from "@/lib/domain/board";
import { requirePermission } from "@/lib/permissions";

const PATH = "/admin/business/board";

async function gate() {
  return requirePermission("board", "write", "/admin/business");
}

export async function createPostAction(fd: FormData) {
  const session = await gate();
  const body = String(fd.get("body") ?? "");
  const pinned = String(fd.get("pinned") ?? "") === "on";
  const audience: BoardAudience = String(fd.get("audience") ?? "chefs") === "all" ? "all" : "chefs";
  const id = await createBoardPost({ authorId: session.user.id, body, pinned, audience });
  if (!id) redirect(`${PATH}?err=empty`);
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "board_post.created",
    resource: "board_posts",
    resourceId: id,
    after: { pinned, audience },
  });
  revalidatePath(PATH);
  redirect(`${PATH}?ok=created`);
}

export async function deletePostAction(fd: FormData) {
  const session = await gate();
  const id = String(fd.get("postId") ?? "");
  if (!id) return;
  await softDeletePost(id);
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "board_post.deleted",
    resource: "board_posts",
    resourceId: id,
  });
  revalidatePath(PATH);
  redirect(`${PATH}?ok=deleted`);
}

export async function togglePinAction(fd: FormData) {
  const session = await gate();
  const id = String(fd.get("postId") ?? "");
  const pinned = String(fd.get("pinned") ?? "") === "true";
  if (!id) return;
  await setPinned(id, pinned);
  await recordAuditFromRequest({
    userId: session.user.id,
    action: "board_post.pin",
    resource: "board_posts",
    resourceId: id,
    after: { pinned },
  });
  revalidatePath(PATH);
  redirect(`${PATH}?ok=pinned`);
}
