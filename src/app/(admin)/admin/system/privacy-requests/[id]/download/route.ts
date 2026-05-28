/**
 * GET /admin/system/privacy-requests/[id]/download — PR-AVG-2.
 *
 * Presigns the stored export package ON DEMAND (~7d) and 302-redirects the
 * super_admin straight to it. No permanent public URL; every link creation is
 * audited (privacy.export_download_link_created). Used by the detail page's
 * "Download" link so the bytes never proxy through our app.
 */

import { NextResponse } from "next/server";

import { createExportDownloadLink } from "@/lib/domain/privacy-export";
import { requireRole } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole("super_admin", "/admin/system/privacy-requests", {
    strict: true,
  });
  const { id } = await params;

  const res = await createExportDownloadLink({ requestId: id, actorId: session.user.id });
  if (!res.ok) {
    return NextResponse.redirect(
      new URL(
        `/admin/system/privacy-requests/${id}?err=${encodeURIComponent(res.error)}`,
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      ),
    );
  }
  return NextResponse.redirect(res.url);
}
