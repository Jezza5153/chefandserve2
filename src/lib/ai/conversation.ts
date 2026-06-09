/**
 * Conversation persistence — server-side mirror of the assistant chat (PR-AI-PERSIST).
 * One active conversation per user per surface; the chat client syncs best-effort (debounced
 * PUT after each turn, GET on mount when its own storage is empty, DELETE on "Gesprek wissen").
 * Caps keep a runaway client from bloating the row; content is the user's own conversation
 * (cascades on user erasure — AVG).
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { aiConversations } from "@/lib/db/schema";

const MAX_MESSAGES = 60;
const MAX_CONTENT_CHARS = 8000;

export type AiSurface = "owner" | "chef" | "client";
export type StoredMsg = { role: "user" | "assistant"; content: string };

/** Validate + cap an untyped messages payload into the stored shape (null = unusable). */
export function sanitizeMessages(raw: unknown): StoredMsg[] | null {
  if (!Array.isArray(raw)) return null;
  const out: StoredMsg[] = [];
  for (const m of raw) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    out.push({ role, content: content.slice(0, MAX_CONTENT_CHARS) });
  }
  return out.slice(-MAX_MESSAGES); // keep the newest tail
}

export async function loadConversation(userId: string, surface: AiSurface): Promise<StoredMsg[]> {
  const [row] = await db
    .select({ messages: aiConversations.messages })
    .from(aiConversations)
    .where(and(eq(aiConversations.userId, userId), eq(aiConversations.surface, surface)))
    .limit(1);
  return sanitizeMessages(row?.messages) ?? [];
}

export async function saveConversation(
  userId: string,
  surface: AiSurface,
  messages: StoredMsg[],
): Promise<{ ok: boolean }> {
  try {
    await db
      .insert(aiConversations)
      .values({ userId, surface, messages })
      .onConflictDoUpdate({
        target: [aiConversations.userId, aiConversations.surface],
        set: { messages, updatedAt: new Date() },
      });
    return { ok: true };
  } catch (err) {
    console.error("[ai/conversation] save failed:", err instanceof Error ? err.message : err);
    return { ok: false };
  }
}

export async function clearConversation(userId: string, surface: AiSurface): Promise<void> {
  await db
    .delete(aiConversations)
    .where(and(eq(aiConversations.userId, userId), eq(aiConversations.surface, surface)));
}
