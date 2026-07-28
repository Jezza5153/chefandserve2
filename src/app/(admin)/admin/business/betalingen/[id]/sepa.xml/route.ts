/**
 * GET /admin/business/betalingen/[id]/sepa.xml — the bank file for one batch.
 *
 * Generating it flips the batch to `generated`, never to `paid`: downloading a file is not
 * a payment, and a bank can still refuse the batch. Confirming execution is a separate,
 * human step on the betalingen page.
 *
 * The response is `no-store` and marked as an attachment. It contains every chef's IBAN in
 * the clear — that is unavoidable, a payment file is what it is — so it must not sit in a
 * proxy cache or render in a browser tab someone leaves open.
 */
import { NextResponse } from "next/server";

import { genereerSepa } from "@/lib/domain/betaalbatch";
import { requirePermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("payroll", "write");
  const { id } = await params;

  const res = await genereerSepa(id, session.user.id);
  if (!res.ok) {
    return new NextResponse(res.error, { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  return new NextResponse(res.xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "content-disposition": `attachment; filename="${res.bestandsnaam}"`,
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}
