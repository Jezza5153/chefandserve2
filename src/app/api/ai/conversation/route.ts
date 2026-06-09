/**
 * /api/ai/conversation — best-effort sync of the assistant chat (GET load · PUT save · DELETE
 * clear). The chat itself stays stateless per turn; this is only the cross-tab/device mirror.
 * Surface is derived from the SESSION (owner | chef | client) — never from the body, so a chef
 * can't read or write another surface. Rate-limited per user; payload capped in sanitizeMessages.
 */
import { NextResponse } from "next/server";

import {
  clearConversation,
  loadConversation,
  sanitizeMessages,
  saveConversation,
  type AiSurface,
} from "@/lib/ai/conversation";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Session-auth + rate-limit; null → the caller already got a Response-worthy denial. */
async function identify(): Promise<{ userId: string; surface: AiSurface } | Response> {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  try {
    const rl = await checkRateLimit("ai_conversation_user", session.user.id);
    if (!rl.ok) return new NextResponse("Too Many Requests", { status: 429 });
  } catch {
    // limiter unavailable → allow
  }
  const surface: AiSurface = hasRole(session, "owner", "super_admin")
    ? "owner"
    : session.user.kind === "chef"
      ? "chef"
      : "client";
  return { userId: session.user.id, surface };
}

export async function GET(): Promise<Response> {
  const id = await identify();
  if (id instanceof Response) return id;
  const messages = await loadConversation(id.userId, id.surface);
  return NextResponse.json({ messages });
}

export async function PUT(req: Request): Promise<Response> {
  const id = await identify();
  if (id instanceof Response) return id;
  let body: { messages?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }
  const messages = sanitizeMessages(body.messages);
  if (!messages) return new NextResponse("Bad Request", { status: 400 });
  const res = await saveConversation(id.userId, id.surface, messages);
  return NextResponse.json({ ok: res.ok });
}

export async function DELETE(): Promise<Response> {
  const id = await identify();
  if (id instanceof Response) return id;
  await clearConversation(id.userId, id.surface);
  return NextResponse.json({ ok: true });
}
