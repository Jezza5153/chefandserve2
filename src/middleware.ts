import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth";

/**
 * Middleware — PR-0F: auth gate + role gates.
 *
 * What it does:
 *   - Auth gate: unauthed /admin/* → /login?next=<path>
 *   - Role gate: /admin/system/* requires super_admin (else → /admin/business)
 *   - Forwards x-cs-app-route + x-cs-pathname headers (for ChromeShell)
 *
 * Host-guard rule (chefandserve.nl → app.chefandserve.nl) remains deferred
 * to production launch — staging is single-host.
 *
 * NOTE: server-side `requireRole` in each page is the source of truth for
 * permissions. Middleware is the first-line UX defense (fast redirects),
 * but never the only gate. Auth.js may not run database checks here on
 * every request, so we don't trust JWT claims alone for sensitive ops.
 */

const APP_PATH_PREFIXES = ["/login", "/verify", "/admin", "/chef", "/client"];
const SYSTEM_ROUTES = ["/admin/system", "/admin/users", "/admin/roles"];

function isSystemPath(path: string): boolean {
  return SYSTEM_ROUTES.some(
    (r) => path === r || path.startsWith(`${r}/`),
  );
}

export default auth((request: NextRequest & {
  auth: import("next-auth").Session | null;
}) => {
  const path = request.nextUrl.pathname;
  const isAppRoute = APP_PATH_PREFIXES.some((p) => path.startsWith(p));
  const isAdminRoute = path.startsWith("/admin");
  const isChefRoute = path.startsWith("/chef");
  const isClientRoute = path.startsWith("/client");
  const needsAuth = isAdminRoute || isChefRoute || isClientRoute;

  // Auth gate: unauthed on /admin|/chef|/client → /login?next=<path>
  if (needsAuth && !request.auth?.user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  // Kind/role gates
  if (request.auth?.user) {
    const roles = request.auth.user.roles ?? [];
    const kind = request.auth.user.kind ?? "internal";

    // /admin/system/* → super_admin only
    if (isAdminRoute && isSystemPath(path)) {
      if (!roles.includes("super_admin")) {
        return NextResponse.redirect(new URL("/admin/business", request.url));
      }
    }

    // /admin/* → super_admin or owner only (NOT chef/client)
    if (isAdminRoute && kind !== "internal") {
      const target = kind === "chef" ? "/chef" : "/client";
      return NextResponse.redirect(new URL(target, request.url));
    }

    // /chef/* → kind=chef OR super_admin (for impersonation later)
    if (isChefRoute && kind !== "chef" && !roles.includes("super_admin")) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }

    // /client/* → kind=client OR super_admin
    if (isClientRoute && kind !== "client" && !roles.includes("super_admin")) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
  }

  // Forward route-type header so ChromeShell can suppress marketing chrome
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-cs-pathname", path);
  if (isAppRoute) requestHeaders.set("x-cs-app-route", "1");

  return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
  matcher: ["/admin/:path*", "/chef/:path*", "/client/:path*", "/login", "/verify"],
};
