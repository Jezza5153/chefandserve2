/**
 * Auth.js v5 route handler.
 *
 * Mounts at /api/auth/* — handles:
 *   POST /api/auth/signin/resend    → triggers Resend magic-link send
 *   GET  /api/auth/callback/resend  → verifies the magic link and signs the user in
 *   POST /api/auth/signout          → clears the session cookie
 *   GET  /api/auth/session          → returns the current session JSON
 *   GET  /api/auth/csrf             → CSRF token endpoint
 */

import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
