/**
 * POST /api/ai/shortlist/propose — P5a-2 action behind the AI shortlist's "Stel voor"
 * button. Proposes one chef for one shift through the SAME audited domain mutation the
 * dashboard fill-drawer uses (proposePlacement) — the deliberate click IS the confirmation,
 * no AI round-trip. Returns JSON (not a redirect) so the chat shows an inline result.
 *
 * Guards: shifts.write (owner / super_admin / planner via RBAC); actor is auth-resolved
 * (session.user.id) and NEVER taken from the body. Dark behind AI_SHORTLIST_ACTIONS_ENABLED.
 * No compliance/margin override here — a blocked chef must be proposed from the fill-drawer
 * where the override-with-reason panel lives.
 */
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { env } from "@/lib/env";
import { proposePlacement } from "@/lib/domain/matching";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (env.AI_SHORTLIST_ACTIONS_ENABLED !== "true") {
    return NextResponse.json({ ok: false, message: "Deze actie staat uit." }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  if (!(await hasPermission(session, "shifts", "write"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }
  const b = (body ?? {}) as { shiftId?: unknown; chefId?: unknown; matchScore?: unknown };
  const shiftId = String(b.shiftId ?? "").trim();
  const chefId = String(b.chefId ?? "").trim();
  // Clamp the score from untrusted input — internal-only, never store NaN/out-of-range.
  const rawScore = Number(b.matchScore);
  const matchScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : undefined;
  if (!shiftId || !chefId) {
    return NextResponse.json({ ok: false, message: "shiftId/chefId ontbreekt." }, { status: 400 });
  }

  try {
    const res = await proposePlacement(shiftId, chefId, { proposedBy: session.user.id, matchScore });
    if (res.status === "blocked") {
      return NextResponse.json({
        ok: false,
        message: `Geblokkeerd (${res.blockers.join(", ")}). Open de dienst om met reden te overrulen.`,
      });
    }
    if (res.status === "already_proposed") {
      return NextResponse.json({ ok: true, message: "Was al voorgesteld." });
    }
    return NextResponse.json({ ok: true, message: "Voorgesteld — de chef krijgt de aanvraag." });
  } catch (e) {
    console.error("[ai/shortlist/propose]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, message: "Kon niet voorstellen — probeer het via de dienst." }, { status: 500 });
  }
}
