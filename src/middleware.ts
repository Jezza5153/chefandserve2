import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import { isImpersonationDeniedPath } from "@/lib/impersonation-denylist";
import { TWOFA_COOKIE_NAME, validateCookieValue } from "@/lib/totp-cookie";

/**
 * Middleware — auth + role + 2FA gates.
 *
 * What it does:
 *   - Auth gate: unauthed /admin|/chef|/client/* → /login?next=<path>
 *   - 2FA gate (PR-S2B, only when TOTP_ENFORCE=true): internal users with
 *     totp_enabled and no valid cs_2fa_verified cookie → /verify-2fa?next=<path>
 *   - Role gate: /admin/system/* requires super_admin (else → /admin/business)
 *   - Forwards x-cs-app-route + x-cs-pathname headers (for ChromeShell)
 *
 * NOTE: server-side `requireRole` in each page is the source of truth for
 * permissions. Middleware is the first-line UX defense (fast redirects),
 * but never the only gate.
 */

const APP_PATH_PREFIXES = ["/login", "/verify", "/admin", "/chef", "/client"];
const SYSTEM_ROUTES = ["/admin/system", "/admin/users", "/admin/roles"];

const TOTP_ENFORCE = process.env.TOTP_ENFORCE === "true";

function isSystemPath(path: string): boolean {
  return SYSTEM_ROUTES.some(
    (r) => path === r || path.startsWith(`${r}/`),
  );
}

export default auth(async (request: NextRequest & {
  auth: import("next-auth").Session | null;
}) => {
  const path = request.nextUrl.pathname;

  // Calendar ICS feeds (/chef/calendar.ics, /client/calendar.ics) are
  // token-authed by their own route handlers (?token=…). External calendar
  // apps (Google/Apple) send NO session cookie, so the auth gate below would
  // redirect them to /login and the subscription would return HTML instead of
  // the .ics payload. Let these specific paths through BEFORE the auth gate.
  // Scoped to the exact filename so nothing else is exposed.
  if (path.endsWith("/calendar.ics")) {
    return NextResponse.next();
  }

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

  // Impersonation write-gate (broad write-impersonation — FLIPPED). While a
  // super_admin views AS someone (cs_impersonate_target set), most writes are
  // allowed and audited as the impersonator (recordAuditFromRequest stamps
  // impersonator_user_id + after._imp). GENUINELY DESTRUCTIVE / irreversible /
  // sensitive-export ops stay blocked by the verified path+method denylist;
  // the matching assertImpersonationAllowed() action guard is the second layer
  // for the path-shared actions this can't split. Stop lives at
  // /api/impersonate/* (not matched here), so it always works.
  if (
    request.cookies.get("cs_impersonate_target")?.value &&
    isImpersonationDeniedPath(path, request.method)
  ) {
    return NextResponse.json(
      {
        error: "impersonation_destructive_blocked",
        message:
          "Onomkeerbare acties zijn geblokkeerd tijdens bekijk-als. Stop bekijk-als om dit te doen.",
      },
      { status: 403 },
    );
  }

  // Setup-wizard gate (PR-S2D) — internal users must complete password +
  // TOTP before reaching any other admin page. Forced regardless of
  // TOTP_ENFORCE. /admin/account/setup/* is the wizard itself.
  if (
    needsAuth &&
    request.auth?.user?.kind === "internal" &&
    !path.startsWith("/admin/account/setup") &&
    (!request.auth.user.hasPassword || !request.auth.user.totpEnabled)
  ) {
    const url = new URL("/admin/account/setup", request.url);
    return NextResponse.redirect(url);
  }

  // 2FA verification gate (PR-S2B) — dark-launched via TOTP_ENFORCE. Only
  // active when:
  //   1. TOTP_ENFORCE=true in env
  //   2. User is internal (kind=internal)
  //   3. User has totp_enabled=true (already enrolled via wizard)
  //   4. No valid cs_2fa_verified cookie for THIS user
  //   5. The current path needs auth (not /verify-2fa itself, not /login)
  //   6. They did NOT sign in via the magic link — a magic-link login is
  //      treated as 2FA-satisfied (control of the inbox IS the second factor),
  //      so it goes straight in. 2FA is only carried on the password path,
  //      where the TOTP code is entered inline at sign-in.
  if (
    TOTP_ENFORCE &&
    needsAuth &&
    path !== "/verify-2fa" &&
    !path.startsWith("/admin/account/setup") &&
    request.auth?.user?.kind === "internal" &&
    request.auth.user.totpEnabled === true &&
    request.auth.user.loginMethod !== "resend"
  ) {
    const cookie = request.cookies.get(TWOFA_COOKIE_NAME)?.value;
    const ok = await validateCookieValue({
      cookieValue: cookie,
      expectedUserId: request.auth.user.id,
      expectedEnrolledAtMs: request.auth.user.totpEnrolledAtMs,
    });
    if (!ok) {
      const verifyUrl = new URL("/verify-2fa", request.url);
      verifyUrl.searchParams.set("next", path);
      return NextResponse.redirect(verifyUrl);
    }
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
  matcher: [
    "/admin/:path*",
    "/chef/:path*",
    "/client/:path*",
    "/login",
    "/verify",
    "/verify-2fa",
  ],
};
