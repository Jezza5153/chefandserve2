import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth";

/**
 * Middleware — PR-0E update: auth gate.
 *
 * What it does now:
 *   - Sets x-cs-app-route + x-cs-pathname headers (used by ChromeShell)
 *   - On /admin/* paths: if unauthed, redirect to /login?next=<path>
 *
 * What PR-0F will add:
 *   - Role gates (super_admin-only on /admin/system/*, /admin/users, /admin/roles)
 *   - IP-based audit_log enrichment
 *
 * Host-guard (chefandserve.nl → app.chefandserve.nl) remains deferred to
 * production launch — staging is single-host.
 */

const APP_PATH_PREFIXES = ["/login", "/verify", "/admin"];

export default auth((request: NextRequest & { auth: import("next-auth").Session | null }) => {
  const path = request.nextUrl.pathname;
  const isAppRoute = APP_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
  const isAdminRoute = path.startsWith("/admin");

  // Auth gate: unauthenticated users hitting /admin/* go to /login
  if (isAdminRoute && !request.auth) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  // Forward route-type header so ChromeShell can suppress marketing chrome
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-cs-pathname", path);
  if (isAppRoute) requestHeaders.set("x-cs-app-route", "1");

  return NextResponse.next({ request: { headers: requestHeaders } });
});

/**
 * Match auth-relevant routes only. Marketing pages skip middleware entirely.
 */
export const config = {
  matcher: ["/admin/:path*", "/login", "/verify"],
};
