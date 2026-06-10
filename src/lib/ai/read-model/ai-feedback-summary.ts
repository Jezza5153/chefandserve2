/**
 * AI-feedback summary read-model — closes the READ side of the 👍/👎 loop (audit: ai_feedback
 * was write-only; a 👎 never reached anyone). Counts + the recent downvotes themselves, so
 * Maarten (or the assistant via feedback.review) can see WHAT went wrong and feed the playbook.
 * Question/answer snippets were already capped at write time; we re-cap for display.
 */
import { and, desc, eq, gt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { aiFeedback } from "@/lib/db/schema";

const SNIPPET = 240;

export type AiFeedbackSummary = {
  windowDays: number;
  total: number;
  up: number;
  down: number;
  /** 0..1, null when no feedback in the window. */
  downRate: number | null;
  recentDownvotes: { question: string; answer: string; channel: string; at: string }[];
};

export async function getAiFeedbackSummary(args: {
  now: Date;
  windowDays?: number;
  downvoteLimit?: number;
}): Promise<AiFeedbackSummary> {
  const windowDays = args.windowDays ?? 30;
  const since = new Date(args.now.getTime() - windowDays * 86_400_000);

  const rows = await db
    .select({ verdict: aiFeedback.verdict })
    .from(aiFeedback)
    .where(gt(aiFeedback.createdAt, since));
  const up = rows.filter((r) => r.verdict === "up").length;
  const down = rows.length - up;

  const recent = await db
    .select({
      question: aiFeedback.question,
      answer: aiFeedback.answer,
      channel: aiFeedback.channel,
      createdAt: aiFeedback.createdAt,
    })
    .from(aiFeedback)
    .where(and(gt(aiFeedback.createdAt, since), eq(aiFeedback.verdict, "down")))
    .orderBy(desc(aiFeedback.createdAt))
    .limit(Math.min(args.downvoteLimit ?? 10, 25));

  return {
    windowDays,
    total: rows.length,
    up,
    down,
    downRate: rows.length ? down / rows.length : null,
    recentDownvotes: recent.map((r) => ({
      question: (r.question ?? "").slice(0, SNIPPET),
      answer: (r.answer ?? "").slice(0, SNIPPET),
      channel: r.channel,
      at: r.createdAt.toISOString().slice(0, 10),
    })),
  };
}
