/**
 * AI feedback recording — the learning loop's raw signal. One row per 👍/👎 on an assistant
 * answer (shared AssistantChat → POST /api/ai/feedback → here). Q/A text is capped so a giant
 * paste can't bloat the table; rows cascade with the user (AVG erasure).
 */
import { db } from "@/lib/db/client";
import { aiFeedback } from "@/lib/db/schema";

const QUESTION_CAP = 1000;
const ANSWER_CAP = 4000;

export type AiFeedbackChannel = "owner" | "chef" | "client";

export async function recordAiFeedback(args: {
  userId: string;
  channel: AiFeedbackChannel;
  verdict: "up" | "down";
  question?: string | null;
  answer?: string | null;
}): Promise<{ ok: boolean; id?: string }> {
  try {
    const [row] = await db
      .insert(aiFeedback)
      .values({
        userId: args.userId,
        channel: args.channel,
        verdict: args.verdict,
        question: args.question ? args.question.slice(0, QUESTION_CAP) : null,
        answer: args.answer ? args.answer.slice(0, ANSWER_CAP) : null,
      })
      .returning({ id: aiFeedback.id });
    return { ok: true, id: row.id };
  } catch (err) {
    console.error("[ai/feedback] insert failed:", err instanceof Error ? err.message : err);
    return { ok: false };
  }
}
