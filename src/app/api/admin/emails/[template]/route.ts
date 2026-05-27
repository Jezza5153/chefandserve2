/**
 * Server-side rendered HTML for a single email template.
 *
 * GET /api/admin/emails/[template]  → text/html (raw email markup)
 *
 * Used by the gallery iframes at /admin/system/emails. Returning HTML
 * rather than a Next page bypasses the admin shell wrapper — the iframe
 * sees just the email.
 *
 * Gated to super_admin. Templates + sample data are imported from the
 * gallery's _samples.ts so previews stay in sync with what's documented.
 */
import { NextResponse } from "next/server";
import { render } from "@react-email/render";

import { requireRole } from "@/lib/permissions";
import { MagicLinkEmail } from "@/emails/MagicLinkEmail";
import { ShiftProposedEmail } from "@/emails/ShiftProposedEmail";
import { ShiftConfirmedClientEmail } from "@/emails/ShiftConfirmedClientEmail";
import { PortalInviteEmail } from "@/emails/PortalInviteEmail";

import {
  sampleProps,
  type TemplateKey,
} from "@/app/(admin)/admin/system/emails/_samples";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID: TemplateKey[] = [
  "magic-link",
  "shift-proposed",
  "shift-confirmed-client",
  "portal-invite",
];

function isValidKey(s: string): s is TemplateKey {
  return (VALID as readonly string[]).includes(s);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ template: string }> },
) {
  // Same role check as the gallery page that links here.
  await requireRole("super_admin");

  const { template } = await params;
  if (!isValidKey(template)) {
    return NextResponse.json(
      { error: `Unknown template '${template}'` },
      { status: 404 },
    );
  }

  let html: string;
  switch (template) {
    case "magic-link":
      html = await render(MagicLinkEmail(sampleProps["magic-link"]));
      break;
    case "shift-proposed":
      html = await render(ShiftProposedEmail(sampleProps["shift-proposed"]));
      break;
    case "shift-confirmed-client":
      html = await render(
        ShiftConfirmedClientEmail(sampleProps["shift-confirmed-client"]),
      );
      break;
    case "portal-invite":
      html = await render(PortalInviteEmail(sampleProps["portal-invite"]));
      break;
  }

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Allow embedding inside the gallery iframe (same origin).
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
}
