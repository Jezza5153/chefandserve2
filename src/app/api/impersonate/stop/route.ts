/**
 * POST /api/impersonate/stop — stop "Bekijk als" (Phase B).
 *
 * Always works, even when the EFFECTIVE role is chef/client: clearing the
 * impersonation cookies is inherently safe and is gated only by possession of
 * the HttpOnly cookies (set server-side). No `requireRole` through the
 * effective session — so the super_admin can never get trapped. Fixed redirect.
 */

import { NextResponse, type NextRequest } from "next/server";

import { stopImpersonation } from "@/lib/domain/impersonation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host) {
    return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  }
  await stopImpersonation(); // reads + clears cookies, audits the stop
  return NextResponse.redirect(new URL("/admin/system", req.nextUrl.origin), { status: 303 });
}
