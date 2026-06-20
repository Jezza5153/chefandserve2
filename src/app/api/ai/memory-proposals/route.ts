/**
 * /api/ai/memory-proposals — the owner's "Zal ik dit onthouden?" inbox (audit gap #4).
 *   GET                        → pending proposals (the nightly miner's suggestions)
 *   POST { id, action }        → accept (→ owner-memory) or dismiss
 *
 * Owner / super_admin only — auth IS the lookup (userId from the session, never the body).
 * Dark with the miner: when AI_MEMORY_MINING_ENABLED is off, GET returns [] (nothing proposes,
 * nothing to show) so the surface stays dormant in prod until the flag + migration 0076 land.
 */
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import {
  acceptMemoryProposal,
  dismissMemoryProposal,
  listPendingProposals,
} from "@/lib/domain/memory-proposals";

export const dynamic = "force-dynamic";

const enabled = () => process.env.AI_MEMORY_MINING_ENABLED === "true";

async function ownerId(): Promise<string | Response> {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  if (!hasRole(session, "owner", "super_admin")) return new NextResponse("Forbidden", { status: 403 });
  return session.user.id;
}

export async function GET(): Promise<Response> {
  const id = await ownerId();
  if (id instanceof Response) return id;
  if (!enabled()) return NextResponse.json({ proposals: [] });
  const proposals = await listPendingProposals(id);
  return NextResponse.json({ proposals });
}

export async function POST(req: Request): Promise<Response> {
  const id = await ownerId();
  if (id instanceof Response) return id;
  // Dark-launch parity with GET + the miner: when the flag is off the surface doesn't exist, so
  // never touch ai_memory_proposals (the table may not be in prod yet). Defense-in-depth — the UI
  // already hides the buttons when disabled.
  if (!enabled()) return new NextResponse("Not Found", { status: 404 });

  let body: { id?: unknown; action?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }
  const proposalId = typeof body.id === "string" ? body.id : "";
  const action = body.action === "accept" || body.action === "dismiss" ? body.action : null;
  if (!proposalId || !action) return new NextResponse("Bad Request", { status: 400 });

  if (action === "dismiss") {
    const ok = await dismissMemoryProposal({ userId: id, id: proposalId });
    return NextResponse.json({ ok });
  }
  const res = await acceptMemoryProposal({ userId: id, id: proposalId });
  return res.ok
    ? NextResponse.json({ ok: true, fact: res.fact, deduped: res.deduped })
    : NextResponse.json({ ok: false, error: res.error }, { status: 409 });
}
