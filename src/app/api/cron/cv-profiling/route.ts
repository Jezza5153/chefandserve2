/**
 * GET /api/cron/cv-profiling — nightly CV → profile-suggestion sweep (CV-AI-1).
 *
 * For every chef with an uploaded CV, extract structured profile fields and stage
 * them as pending suggestions for owner/chef review (the same path the
 * chefs.enrich_from_cv tool uses). The planner/owner reviews; nothing is applied.
 *
 * Idempotent: writeCvSuggestions skips fields already decided for the same CV
 * version (sourceHash) and supersedes stale pending rows, so re-fires are
 * harmless. Dark-launched: no-op unless CV_AI_PROFILING_ENABLED=true. Bounded to
 * MAX_CHEFS per run (OpenAI rate + maxDuration). Auth: Bearer CRON_SECRET.
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";

import { extractChefProfileFromCv } from "@/lib/ai/read-model/chef-cv-extract";
import { db } from "@/lib/db/client";
import { chefDocuments, chefs } from "@/lib/db/schema";
import { writeCvSuggestions } from "@/lib/domain/profile-suggestions";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_CHEFS = 40;

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
  if (process.env.CV_AI_PROFILING_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: "disabled" }, { status: 200 });
  }
  if (!env.OPENAI_API_KEY) {
    return NextResponse.json({ ok: true, skipped: "no model key" }, { status: 200 });
  }

  // Chefs with an own-uploaded, non-rejected CV (same selection as ingestCvs).
  const rows = await db
    .selectDistinct({ chefId: chefDocuments.chefId })
    .from(chefDocuments)
    .innerJoin(chefs, eq(chefs.id, chefDocuments.chefId))
    .where(
      and(
        eq(chefDocuments.type, "cv"),
        isNull(chefDocuments.deletedAt),
        ne(chefDocuments.status, "rejected"),
        isNull(chefs.deletedAt),
        isNotNull(chefs.userId),
        sql`${chefDocuments.uploadedBy} = ${chefs.userId}`,
      ),
    )
    .limit(MAX_CHEFS);
  const chefIds = rows.map((r) => r.chefId).filter(Boolean);

  let withCv = 0;
  let suggested = 0;
  for (const chefId of chefIds) {
    try {
      const extract = await extractChefProfileFromCv(chefId);
      if (!extract) continue;
      withCv++;
      const { written } = await writeCvSuggestions(chefId, extract, null);
      suggested += written;
    } catch {
      // one chef's bad CV must never wedge the sweep
    }
  }

  return NextResponse.json(
    { ok: true, scanned: chefIds.length, withReadableCv: withCv, suggestionsWritten: suggested },
    { status: 200 },
  );
}
