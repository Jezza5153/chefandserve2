import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware — Phase 0 (PR-0B): mostly a no-op.
 *
 * What it does today:
 *   - Adds a header so we can confirm middleware is running on /admin/* + /login + /verify
 *   - Nothing else. Auth is added in PR-0E; role gates land in PR-0F.
 *
 * What it WILL do once Phase 0 is complete:
 *   - PR-0E: redirect unauthed /admin/* → /login?next=<path>
 *   - PR-0F: enforce role gates (super_admin only on /admin/system/*, etc.)
 *
 * Host-guard rule (chefandserve.nl/login → app.chefandserve.nl/login) is
 * DELIBERATELY DEFERRED until production launch. During staging everything
 * runs on chefandserve2.vercel.app — same host for marketing + app.
 *
 * On launch day we'll add:
 *   const isMarketingHost = host === "chefandserve.nl"
 *                        || host === "www.chefandserve.nl";
 *   const isAppHost      = host === "app.chefandserve.nl";
 *   if (isMarketingHost && (path matches app routes)) {
 *     return NextResponse.redirect(`https://app.chefandserve.nl${path}`, 308);
 *   }
 */

const APP_PATH_PREFIXES = ["/login", "/verify", "/admin"];

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isAppRoute = APP_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));

  // Forward a request header so the root layout can suppress the marketing
  // Header/Footer on app routes without moving the 29 marketing pages into
  // a separate route group.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-cs-pathname", path);
  if (isAppRoute) {
    requestHeaders.set("x-cs-app-route", "1");
  }

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

/**
 * Match only app routes; skip Next internals and static assets entirely.
 * Marketing pages don't need any middleware processing.
 */
export const config = {
  matcher: [
    "/admin/:path*",
    "/login",
    "/verify",
    /*
     * Excludes:
     *   - /api/auth/* (Auth.js handler, added in PR-0E)
     *   - /_next/static, /_next/image, favicon.ico
     *   - All marketing pages (homepage + 28 service/info pages)
     */
  ],
};
