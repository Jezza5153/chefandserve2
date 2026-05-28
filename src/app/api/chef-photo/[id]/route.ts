/**
 * GET /api/chef-photo/[id] — serves a chef's profile photo via R2 redirect.
 *
 * Auth (PII — a person's face — so conservative; ambiguous = deny):
 *   - the chef themself
 *   - super_admin
 *   - a klant (session.user.kind === 'client') ONLY when the photo is
 *     clientVisible AND verified AND that klant has a placement with this
 *     chef on one of THEIR shifts (prevents photo enumeration). PR-KLANT-3.
 * R2 not configured → 404. Photo deleted (deletedAt set) → 404.
 *
 * Redirects to a 15-minute presigned R2 GET URL. The browser caches the
 * redirect target briefly so successive renders don't re-presign each time.
 */

import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import {
  chefDocuments,
  chefs,
  clients,
  placements,
  shifts,
} from "@/lib/db/schema";
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
      clientVisible: chefDocuments.clientVisible,
      verifiedAt: chefDocuments.verifiedAt,
    })
    .from(chefDocuments)
    .where(and(eq(chefDocuments.id, id), isNull(chefDocuments.deletedAt)))
    .limit(1);

  if (!doc || doc.type !== "photo") {
    return new NextResponse("Not Found", { status: 404 });
  }

  // Access control (conservative — deny on any ambiguity).
  let allowed = Boolean(session.user.roles?.includes("super_admin"));

  if (!allowed) {
    // 1. The chef themself.
    const [chef] = await db
      .select({ userId: chefs.userId })
      .from(chefs)
      .where(eq(chefs.id, doc.chefId))
      .limit(1);
    if (chef?.userId === session.user.id) {
      allowed = true;
    } else if (
      // 2. A klant — only for a clientVisible + verified photo of a chef
      //    placed on one of their own shifts (no enumeration of arbitrary
      //    chef photos).
      session.user.kind === "client" &&
      doc.clientVisible &&
      doc.verifiedAt
    ) {
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.userId, session.user.id))
        .limit(1);
      if (client) {
        const [link] = await db
          .select({ id: placements.id })
          .from(placements)
          .innerJoin(shifts, eq(shifts.id, placements.shiftId))
          .where(
            and(
              eq(placements.chefId, doc.chefId),
              eq(shifts.clientId, client.id),
            ),
          )
          .limit(1);
        if (link) allowed = true;
      }
    }
  }

  if (!allowed) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const url = await getDownloadUrl(doc.r2Key);
  return NextResponse.redirect(url, 302);
}
