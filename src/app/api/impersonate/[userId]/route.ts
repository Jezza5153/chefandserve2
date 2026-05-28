/**
 * POST /api/impersonate/[userId] — start "Bekijk als" (Phase B).
 *
 * Hardened: POST only · real super_admin only (reads `auth()`, the REAL JWT
 * session — never the impersonation overlay) · same-origin check · fixed
 * redirect by target kind (no open redirect, no querystring target). Setting
 * the cookie only takes effect via `applyImpersonation`, which re-verifies
 * every guard on each request.
 */

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { startImpersonation } from "@/lib/domain/impersonation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const real = await auth();
  if (!real?.user || !real.user.roles?.includes("super_admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // CSRF: a same-origin form POST sends Origin = our host.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host) {
    return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  }

  const { userId } = await params;
  const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!target || target.status !== "active") {
    return NextResponse.json({ error: "target_unavailable" }, { status: 400 });
  }

  const result = await startImpersonation(userId, real.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Fixed redirect targets only — never a caller-supplied URL.
  const dest =
    target.kind === "chef" ? "/chef" : target.kind === "client" ? "/client" : "/admin/business";
  return NextResponse.redirect(new URL(dest, req.nextUrl.origin), { status: 303 });
}
