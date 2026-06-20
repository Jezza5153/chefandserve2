/**
 * AI memory proposals (audit gap #4) — the bridge between the nightly conversation-mining worker
 * (which PROPOSES durable facts) and owner-memory (where ACCEPTED facts live). One-click accept:
 * the owner sees "Zal ik dit onthouden? …" and presses Onthoud → the exact fact lands in memory
 * via rememberFact. Human-approved memory stays the rule; this just removes the re-typing.
 *
 * Auth is the lookup everywhere: the caller passes the SESSION user id, never a body value.
 */
import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { recordAuditFromRequest } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { aiMemoryProposals } from "@/lib/db/schema";
import { normalizeFactText, rememberFact } from "@/lib/ai/read-model/owner-memory";

export type PendingProposal = { id: string; fact: string; createdAt: string };

/** Open proposals for this owner, newest first. */
export async function listPendingProposals(userId: string): Promise<PendingProposal[]> {
  const rows = await db
    .select({ id: aiMemoryProposals.id, fact: aiMemoryProposals.fact, createdAt: aiMemoryProposals.createdAt })
    .from(aiMemoryProposals)
    .where(and(eq(aiMemoryProposals.userId, userId), eq(aiMemoryProposals.status, "pending")))
    .orderBy(desc(aiMemoryProposals.createdAt))
    .limit(20);
  return rows.map((r) => ({ id: r.id, fact: r.fact, createdAt: r.createdAt.toISOString() }));
}

/** Normalized text of this owner's already-pending proposals — so the miner doesn't re-propose
 *  a fact that's still waiting on a decision (it already dedups against ACCEPTED memory). */
export async function pendingProposalNorms(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ factNorm: aiMemoryProposals.factNorm })
    .from(aiMemoryProposals)
    .where(and(eq(aiMemoryProposals.userId, userId), eq(aiMemoryProposals.status, "pending")));
  return new Set(rows.map((r) => r.factNorm));
}

/** Insert fresh proposals (one row per fact). The partial-unique on (user, factNorm) WHERE
 *  pending makes a re-run ON CONFLICT DO NOTHING instead of stacking duplicates. Returns the
 *  count actually inserted. */
export async function createMemoryProposals(args: {
  userId: string;
  facts: string[];
  source?: string;
}): Promise<number> {
  const values = args.facts
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
    .map((fact) => ({
      userId: args.userId,
      fact,
      factNorm: normalizeFactText(fact),
      source: args.source ?? "mining",
    }));
  if (values.length === 0) return 0;
  const inserted = await db
    .insert(aiMemoryProposals)
    .values(values)
    // The arbiter is a PARTIAL unique index (… WHERE status='pending'); the ON CONFLICT MUST
    // carry the same predicate or Postgres throws 42P10 (verified on dev). See CLAUDE.md.
    .onConflictDoNothing({
      target: [aiMemoryProposals.userId, aiMemoryProposals.factNorm],
      where: eq(aiMemoryProposals.status, "pending"),
    })
    .returning({ id: aiMemoryProposals.id });
  return inserted.length;
}

export type AcceptResult =
  | { ok: true; fact: string; deduped: boolean }
  | { ok: false; error: string };

/** Accept ONE proposal: atomically claim it (pending → accepted, reject if already decided),
 *  then write the exact fact into owner-memory and audit it. */
export async function acceptMemoryProposal(args: { userId: string; id: string }): Promise<AcceptResult> {
  const [claimed] = await db
    .update(aiMemoryProposals)
    .set({ status: "accepted", decidedAt: new Date() })
    .where(
      and(
        eq(aiMemoryProposals.id, args.id),
        eq(aiMemoryProposals.userId, args.userId),
        eq(aiMemoryProposals.status, "pending"),
      ),
    )
    .returning({ fact: aiMemoryProposals.fact });
  if (!claimed) return { ok: false, error: "Dit voorstel is al verwerkt." };

  const res = await rememberFact({
    userId: args.userId,
    text: claimed.fact,
    id: randomUUID(),
    now: new Date().toISOString(),
  });
  await recordAuditFromRequest({
    userId: args.userId,
    action: "memory.proposal_accepted",
    resource: "ai_memory_proposals",
    resourceId: args.id,
    after: { fact: claimed.fact, deduped: res.deduped },
  });
  return { ok: true, fact: claimed.fact, deduped: res.deduped };
}

/** Dismiss ONE proposal (pending → dismissed). Idempotent: a second click is a harmless no-op. */
export async function dismissMemoryProposal(args: { userId: string; id: string }): Promise<boolean> {
  const [claimed] = await db
    .update(aiMemoryProposals)
    .set({ status: "dismissed", decidedAt: new Date() })
    .where(
      and(
        eq(aiMemoryProposals.id, args.id),
        eq(aiMemoryProposals.userId, args.userId),
        eq(aiMemoryProposals.status, "pending"),
      ),
    )
    .returning({ id: aiMemoryProposals.id });
  if (!claimed) return false;
  await recordAuditFromRequest({
    userId: args.userId,
    action: "memory.proposal_dismissed",
    resource: "ai_memory_proposals",
    resourceId: args.id,
  });
  return true;
}
