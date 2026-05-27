/**
 * GET /api/chef-photo/[id] — serves a chef's profile photo via R2 redirect.
 *
 * Auth: chef can see their own photo; super_admin can see any.
 * R2 not configured → 404 (no image).
 * Photo deleted (deletedAt set) → 404.
 *
 * Redirects to a 15-minute presigned R2 GET URL. The browser caches the
 * redirect target briefly so successive renders don't re-presign each time.
 */

import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { chefDocuments, chefs } from "@/lib/db/schema";
import { getDownloadUrl, r2IsConfigured } from "@/lib/r2";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!r2IsConfigured()) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const { id } = await ctx.params;

  const [doc] = await db
    .select({
      r2Key: chefDocuments.r2Key,
      chefId: chefDocuments.chefId,
      type: chefDocuments.type,
    })
    .from(chefDocuments)
    .where(and(eq(chefDocuments.id, id), isNull(chefDocuments.deletedAt)))
    .limit(1);

  if (!doc || doc.type !== "photo") {
    return new NextResponse("Not Found", { status: 404 });
  }

  // Access control: chef themself OR super_admin.
  const isSuperAdmin = session.user.roles?.includes("super_admin");
  if (!isSuperAdmin) {
    const [chef] = await db
      .select({ userId: chefs.userId })
      .from(chefs)
      .where(eq(chefs.id, doc.chefId))
      .limit(1);
    if (chef?.userId !== session.user.id) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  const url = await getDownloadUrl(doc.r2Key);
  return NextResponse.redirect(url, 302);
}
