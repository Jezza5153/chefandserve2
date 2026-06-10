/**
 * GET /api/cron/ai-preplan — the nightly pre-plan (wave W3, the real "AI at scale" lever):
 * while everyone sleeps, autofillWeek() drafts every open slot of the coming 7 days as
 * CONCEPTS (invisible to chef + klant); the planner arrives to "AI heeft N van M plekken
 * vooringevuld — review & publiceer". Humans approve, the engine does the first pass.
 *
 * Idempotent by design: covered slots (incl. existing concepts) are skipped, so re-fires are
 * harmless. Dark-launched: no-op unless AI_PREPLAN_ENABLED=true. Auth: Bearer CRON_SECRET.
 * Thin Railway ticker: workers/ai-preplan.ts (daily 05:30 Amsterdam).
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { autofillWeek } from "@/lib/domain/roster-autofill";
import { env } from "@/lib/env";
import { createNotification } from "@/lib/integrations/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  if (process.env.AI_PREPLAN_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: "disabled" }, { status: 200 });
  }
  if (!env.MAARTEN_EMAIL) {
    return NextResponse.json({ ok: true, skipped: "no owner configured" }, { status: 200 });
  }
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, env.MAARTEN_EMAIL)).limit(1);
  if (!owner) return NextResponse.json({ ok: true, skipped: "owner not found" }, { status: 200 });

  const start = new Date();
  const res = await autofillWeek({
    startUtc: start,
    endUtc: new Date(start.getTime() + 7 * 24 * 3600 * 1000),
    actorUserId: owner.id,
  });

  // Tell the team only when there was something to plan.
  let notified = false;
  if (res.openSlotsBefore > 0) {
    const n = await createNotification({
      userId: owner.id,
      type: "ai_preplan",
      title:
        res.filled > 0
          ? `Nachtplan: ${res.filled} van ${res.openSlotsBefore} plekken vooringevuld`
          : `Nachtplan: geen kandidaten voor ${res.openSlotsBefore} open plek(ken)`,
      body:
        res.filled > 0
          ? `De matching-engine heeft ${res.shiftsTouched} dienst(en) als concept voorgevuld — onzichtbaar voor chef & klant tot je publiceert. Review & publiceer in het planbord.`
          : "Overweeg het tarief te verhogen, de selectie te verbreden of nieuwe chefs te werven (zie demand.forecast).",
      actionUrl: "/admin/business/roster/planbord",
    });
    notified = n.ok;
  }

  return NextResponse.json({ ok: true, ...res, notified }, { status: 200 });
}
