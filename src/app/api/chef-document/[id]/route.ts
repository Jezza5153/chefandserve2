/**
 * GET /api/chef-document/[id] — generic chef-document download.
 *
 * PR-CHEF-12. Like /api/chef-photo/[id] but for ANY document type (CV,
 * certificate, id_document, etc.). Same ownership pattern:
 *   - chef themselves: always allowed for their own docs
 *   - super_admin / owner: allowed for any
 *   - klant: allowed ONLY when doc.clientVisible=true AND status='verified'
 *     AND the klant has a CONFIRMED placement involving this chef
 *
 * Soft-deleted docs → 404. R2-not-configured → 404.
 *
 * Returns a 302 redirect to a 15-minute presigned R2 URL.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
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
      status: chefDocuments.status,
    })
    .from(chefDocuments)
    .where(and(eq(chefDocuments.id, id), isNull(chefDocuments.deletedAt)))
    .limit(1);

  if (!doc) return new NextResponse("Not Found", { status: 404 });

  const isAdmin =
    session.user.roles?.includes("super_admin") ||
    session.user.roles?.includes("owner");

  if (isAdmin) {
    const url = await getDownloadUrl(doc.r2Key);
    return NextResponse.redirect(url, 302);
  }

  // Owning chef
  if (session.user.kind === "chef") {
    const [chef] = await db
      .select({ userId: chefs.userId })
      .from(chefs)
      .where(eq(chefs.id, doc.chefId))
      .limit(1);
    if (chef?.userId === session.user.id) {
      const url = await getDownloadUrl(doc.r2Key);
      return NextResponse.redirect(url, 302);
    }
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Klant — visibility-gated AND must have a CONFIRMED placement involving this chef
  if (session.user.kind === "client") {
    if (!doc.clientVisible || doc.status !== "verified") {
      return new NextResponse("Forbidden", { status: 403 });
    }
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.userId, session.user.id))
      .limit(1);
    if (!client) return new NextResponse("Forbidden", { status: 403 });

    // Does this klant have a confirmed placement with this chef?
    const rows = await db
      .select({ id: placements.id })
      .from(placements)
      .innerJoin(shifts, eq(shifts.id, placements.shiftId))
      .where(
        and(
          eq(placements.chefId, doc.chefId),
          eq(shifts.clientId, client.id),
          inArray(placements.status, ["confirmed", "completed"]),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const url = await getDownloadUrl(doc.r2Key);
    return NextResponse.redirect(url, 302);
  }

  return new NextResponse("Forbidden", { status: 403 });
}
