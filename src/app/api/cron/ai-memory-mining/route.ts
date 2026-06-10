/**
 * GET /api/cron/ai-memory-mining — conversation→memory mining (wave PR-6, audit: durable facts
 * said mid-chat were lost unless Maarten explicitly called memory.remember).
 *
 * Nightly: scan OWNER-surface conversations updated in the last 24h, ask a CHEAP model to
 * extract up to 3 DURABLE facts per conversation (standing preferences, client rules — not
 * ephemeral chatter), dedup against existing owner-memory, and send the owner ONE notification
 * proposing them. PROPOSE-ONLY — nothing is auto-written to memory; Maarten approves by saying
 * "onthoud dat …" in the chat (human-approved memory stays the rule).
 *
 * Dark-launched: no-op unless AI_MEMORY_MINING_ENABLED=true. Auth: Bearer CRON_SECRET.
 * Cost: ≤10 conversations/run × 1 cheap-model call.
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";

import { listOwnerMemory, normalizeFactText } from "@/lib/ai/read-model/owner-memory";
import { db } from "@/lib/db/client";
import { aiConversations, notifications } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createNotification } from "@/lib/integrations/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_CONVERSATIONS = 10;
const MAX_FACTS_PER_CONVO = 3;
const MSG_CAP = 500;
const MINING_MODEL_FALLBACK = "gpt-4.1-mini";

function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type StoredMsg = { role: string; content: string };

/** One cheap-model call: extract durable facts as strict JSON. Conversation text is the owner's
 *  own chat (semi-trusted) but still passed as quoted DATA under a strict extraction prompt. */
async function extractFacts(messages: StoredMsg[]): Promise<string[]> {
  const model = env.OPENAI_FALLBACK_MODEL ?? MINING_MODEL_FALLBACK;
  const transcript = messages
    .slice(-30)
    .map((m) => `${m.role === "user" ? "EIGENAAR" : "ASSISTENT"}: ${String(m.content).slice(0, MSG_CAP)}`)
    .join("\n");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      max_completion_tokens: 300,
      messages: [
        {
          role: "system",
          content:
            'Je krijgt een chat tussen een uitzendbureau-eigenaar en zijn assistent. Haal er maximaal 3 DUURZAME feiten uit die de EIGENAAR stelde en die blijvend waar zijn (vaste klantvoorkeuren, werkregels, "onthoud dat …"-uitspraken). GEEN eenmalige acties, vragen of dingen die de assistent zei. Antwoord als JSON: {"facts": ["…"]}. Geen duurzame feiten → {"facts": []}.',
        },
        { role: "user", content: transcript },
      ],
    }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  try {
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as { facts?: unknown };
    if (!Array.isArray(parsed.facts)) return [];
    return parsed.facts.filter((f): f is string => typeof f === "string" && f.length > 5).slice(0, MAX_FACTS_PER_CONVO);
  } catch {
    return [];
  }
}

export async function GET(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  if (process.env.AI_MEMORY_MINING_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: "disabled" }, { status: 200 });
  }
  if (!env.OPENAI_API_KEY) {
    return NextResponse.json({ ok: true, skipped: "no OPENAI_API_KEY" }, { status: 200 });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // Owner-surface only: mining a chef/klant chat into OWNER memory would cross contexts.
  const convos = await db
    .select({ userId: aiConversations.userId, messages: aiConversations.messages })
    .from(aiConversations)
    .where(and(eq(aiConversations.surface, "owner"), gt(aiConversations.updatedAt, since)))
    .limit(MAX_CONVERSATIONS);

  let proposed = 0;
  let notified = 0;
  for (const convo of convos) {
    const msgs = Array.isArray(convo.messages) ? (convo.messages as StoredMsg[]) : [];
    if (msgs.length === 0) continue;

    // Max one proposal notification per user per 20h — never a daily nag.
    const recent = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, convo.userId),
          eq(notifications.type, "ai_memory_proposal"),
          gt(notifications.createdAt, new Date(Date.now() - 20 * 60 * 60 * 1000)),
        ),
      )
      .limit(1);
    if (recent.length > 0) continue;

    const facts = await extractFacts(msgs).catch(() => [] as string[]);
    if (facts.length === 0) continue;

    // Dedup against what's already remembered.
    const known = new Set((await listOwnerMemory(convo.userId)).map((f) => normalizeFactText(f.text)));
    const fresh = facts.filter((f) => !known.has(normalizeFactText(f)));
    if (fresh.length === 0) continue;

    proposed += fresh.length;
    const res = await createNotification({
      userId: convo.userId,
      type: "ai_memory_proposal",
      title: "Zal ik dit onthouden?",
      body: `Uit je recente gesprekken: ${fresh.map((f) => `"${f.slice(0, 100)}"`).join(" · ")}. Zeg in de chat "onthoud dat …" voor wat ik moet bewaren.`,
      actionUrl: "/admin/assistant",
    });
    if (res.ok) notified++;
  }

  return NextResponse.json({ ok: true, conversations: convos.length, proposed, notified }, { status: 200 });
}
