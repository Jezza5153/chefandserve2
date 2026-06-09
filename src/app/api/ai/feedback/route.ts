/**
 * POST /api/ai/feedback — 👍/👎 on an assistant answer (the learning loop's intake).
 * Any authenticated user (owner/chef/klant — channel derived from the session, never from the
 * body). Rate-limited per user; body text capped in recordAiFeedback. Stores only; no automated
 * behaviour hangs off this yet (mined for playbook/eval improvements).
 */
import { NextResponse } from "next/server";

import { recordAiFeedback, type AiFeedbackChannel } from "@/lib/ai/feedback";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });

  try {
    const rl = await checkRateLimit("ai_feedback_user", session.user.id);
    if (!rl.ok) return new NextResponse("Too Many Requests", { status: 429 });
  } catch {
    // limiter unavailable → allow
  }

  let body: { verdict?: unknown; question?: unknown; answer?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }
  const verdict = body.verdict === "up" || body.verdict === "down" ? body.verdict : null;
  if (!verdict) return new NextResponse("Bad Request", { status: 400 });

  const channel: AiFeedbackChannel = hasRole(session, "owner", "super_admin")
    ? "owner"
    : session.user.kind === "chef"
      ? "chef"
      : "client";

  const res = await recordAiFeedback({
    userId: session.user.id,
    channel,
    verdict,
    question: typeof body.question === "string" ? body.question : null,
    answer: typeof body.answer === "string" ? body.answer : null,
  });
  return NextResponse.json({ ok: res.ok });
}
