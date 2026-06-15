/**
 * POST /api/chef/arrival — CHEF-PR3 Arrival Trust result sink.
 *
 * The chef's PWA did the 1 km check ON-DEVICE and POSTs ONLY the result event
 * ({ shiftId, event }). This endpoint accepts NO coordinates and NO route — by
 * design. Chef-session auth + ownership (recordArrivalEvent re-checks the chef is
 * placed on the shift). Dark behind ARRIVAL_TRUST_ENABLED (the domain re-checks it).
 */
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import { recordArrivalEvent, type ArrivalEvent } from "@/lib/domain/arrival";

export const dynamic = "force-dynamic";

const ALLOWED: ArrivalEvent[] = ["monitoring", "nearby", "no_signal", "permission_missing", "stopped"];

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.userId, session.user.id) });
  if (!chef) return new NextResponse("Forbidden", { status: 403 });

  let body: { shiftId?: unknown; event?: unknown };
  try {
    body = (await req.json()) as { shiftId?: unknown; event?: unknown };
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  const shiftId = typeof body.shiftId === "string" ? body.shiftId : "";
  const event = body.event as ArrivalEvent;
  if (!shiftId || !ALLOWED.includes(event)) return new NextResponse("Bad request", { status: 400 });

  const result = await recordArrivalEvent({ chefId: chef.id, shiftId, event });
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
