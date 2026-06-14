/**
 * Profile suggestions (CV-AI-1) — staging + apply for AI-extracted enrichment.
 *
 * writeCvSuggestions diffs the model's extraction against the chef's current
 * profile and stages pending rows. accept/dismiss are atomic (WHERE status=
 * 'pending', reject 0 rows). Accepting routes by field-class:
 *   - SAFE (segments/specialties/languages/yearsExperience) → applyChefSafeField
 *     (the same direct write /chef/profile's saveProfile uses).
 *   - SENSITIVE (vakniveau) → owner applies directly; a CHEF instead files a
 *     profile_change_request so owner approval stays the single rail.
 *
 * neon-http: no interactive tx → atomic single statements + claim-then-apply.
 */
import { and, eq, sql } from "drizzle-orm";

import { recordAuditCore } from "@/lib/audit";
import type { CvExtractResult } from "@/lib/ai/read-model/chef-cv-extract";
import { db } from "@/lib/db/client";
import {
  chefs,
  profileChangeRequests,
  profileSuggestions,
} from "@/lib/db/schema";

/** Code-owned routing — the model NEVER decides a field's class. */
export const CV_FIELD_CLASS: Record<string, "safe" | "sensitive"> = {
  segments: "safe",
  specialties: "safe",
  languages: "safe",
  yearsExperience: "safe",
  vakniveau: "sensitive",
};

export const SUGGESTION_FIELD_LABEL: Record<string, string> = {
  vakniveau: "Vakniveau",
  segments: "Segmenten",
  specialties: "Specialiteiten",
  languages: "Talen",
  yearsExperience: "Jaren ervaring",
};

function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function union(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}

type Diff = { field: string; current: unknown; proposed: unknown };

/**
 * Stage CV-extracted fields as pending suggestions. Supersedes the chef's prior
 * pending CV rows first (clean inbox + idempotent re-sweeps), then inserts only
 * the fields that would actually change. Array fields (segments/languages) are
 * ADDITIVE (union — the CV adds, never removes). Returns the diffs it staged.
 */
export async function writeCvSuggestions(
  chefId: string,
  extract: CvExtractResult,
  createdBy: string | null,
): Promise<{ written: number; diffs: Diff[] }> {
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, chefId) });
  if (!chef) return { written: 0, diffs: [] };

  const f = extract.fields;
  const diffs: Diff[] = [];

  if (f.vakniveau && f.vakniveau !== chef.vakniveau) {
    diffs.push({ field: "vakniveau", current: chef.vakniveau ?? null, proposed: f.vakniveau });
  }
  const curSeg = asStrArr(chef.segments);
  const newSeg = union(curSeg, f.segments);
  if (newSeg.length > curSeg.length) {
    diffs.push({ field: "segments", current: curSeg, proposed: newSeg });
  }
  const curLang = asStrArr(chef.languages);
  const newLang = union(curLang, f.languages);
  if (newLang.length > curLang.length) {
    diffs.push({ field: "languages", current: curLang, proposed: newLang });
  }
  if (f.specialties && f.specialties !== (chef.specialties ?? null)) {
    diffs.push({ field: "specialties", current: chef.specialties ?? null, proposed: f.specialties });
  }
  if (
    f.yearsExperience != null &&
    (chef.yearsExperience == null || f.yearsExperience > chef.yearsExperience)
  ) {
    diffs.push({
      field: "yearsExperience",
      current: chef.yearsExperience ?? null,
      proposed: f.yearsExperience,
    });
  }

  // Supersede prior pending CV suggestions (atomic single statement).
  await db
    .update(profileSuggestions)
    .set({ status: "superseded", updatedAt: new Date() })
    .where(
      and(
        eq(profileSuggestions.chefId, chefId),
        eq(profileSuggestions.source, "cv"),
        eq(profileSuggestions.status, "pending"),
      ),
    );

  if (diffs.length === 0) {
    await recordAuditCore({
      userId: createdBy,
      action: "ai.cv_suggestions_written",
      resource: "chefs",
      resourceId: chefId,
      after: { written: 0, confidence: extract.confidence },
    });
    return { written: 0, diffs: [] };
  }

  await db
    .insert(profileSuggestions)
    .values(
      diffs.map((d) => ({
        chefId,
        field: d.field,
        fieldClass: CV_FIELD_CLASS[d.field] ?? "sensitive",
        currentValue: d.current as never,
        proposedValue: d.proposed as never,
        source: "cv" as const,
        confidence: extract.confidence.toFixed(2),
        sourceHash: extract.sourceHash,
        createdBy,
      })),
    )
    .onConflictDoNothing();

  await recordAuditCore({
    userId: createdBy,
    action: "ai.cv_suggestions_written",
    resource: "chefs",
    resourceId: chefId,
    after: { written: diffs.length, fields: diffs.map((d) => d.field), confidence: extract.confidence },
  });

  return { written: diffs.length, diffs };
}

export type PendingSuggestion = {
  id: string;
  field: string;
  fieldClass: "safe" | "sensitive";
  currentValue: unknown;
  proposedValue: unknown;
  source: "cv" | "completeness";
  confidence: number | null;
};

export async function listPendingSuggestions(chefId: string): Promise<PendingSuggestion[]> {
  const rows = await db
    .select({
      id: profileSuggestions.id,
      field: profileSuggestions.field,
      fieldClass: profileSuggestions.fieldClass,
      currentValue: profileSuggestions.currentValue,
      proposedValue: profileSuggestions.proposedValue,
      source: profileSuggestions.source,
      confidence: profileSuggestions.confidence,
    })
    .from(profileSuggestions)
    .where(and(eq(profileSuggestions.chefId, chefId), eq(profileSuggestions.status, "pending")))
    .orderBy(profileSuggestions.createdAt);
  return rows.map((r) => ({
    ...r,
    confidence: r.confidence == null ? null : Number(r.confidence),
  }));
}

/** Direct write of a SAFE chef field (the saveProfile path) + audit. Shared. */
export async function applyChefSafeField(args: {
  chefId: string;
  field: string;
  value: unknown;
  actorUserId: string;
}): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  switch (args.field) {
    case "segments":
      set.segments = asStrArr(args.value).length ? asStrArr(args.value) : null;
      break;
    case "languages":
      set.languages = asStrArr(args.value).length ? asStrArr(args.value) : null;
      break;
    case "specialties":
      set.specialties =
        typeof args.value === "string" && args.value.trim() ? args.value : null;
      break;
    case "yearsExperience":
      set.yearsExperience = typeof args.value === "number" ? args.value : null;
      break;
    default:
      throw new Error(`niet-veilig veld: ${args.field}`);
  }
  await db.update(chefs).set(set).where(eq(chefs.id, args.chefId));
  await recordAuditCore({
    userId: args.actorUserId,
    action: "chef.profile_updated",
    resource: "chefs",
    resourceId: args.chefId,
    after: { [args.field]: set[args.field], via: "ai_suggestion" },
  });
}

export type AcceptResult =
  | { ok: true; field: string; applied: "saved" | "requested" }
  | { ok: false; reason: "al behandeld" | "chef niet gevonden" };

/**
 * Accept a pending suggestion. Atomic claim (pending→accepted) then route by
 * field-class. `actorKind` decides the sensitive path: an owner applies a
 * vakniveau directly (they're the approver); a chef files a change request.
 */
export async function acceptSuggestion(args: {
  suggestionId: string;
  decidedBy: string;
  actorKind: "owner" | "chef";
  /** When set, the claim only matches a suggestion owned by this chef (chef-side ownership). */
  expectChefId?: string;
}): Promise<AcceptResult> {
  const [claimed] = await db
    .update(profileSuggestions)
    .set({ status: "accepted", decidedBy: args.decidedBy, decidedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(profileSuggestions.id, args.suggestionId),
        eq(profileSuggestions.status, "pending"),
        args.expectChefId ? eq(profileSuggestions.chefId, args.expectChefId) : undefined,
      ),
    )
    .returning({
      chefId: profileSuggestions.chefId,
      field: profileSuggestions.field,
      fieldClass: profileSuggestions.fieldClass,
      currentValue: profileSuggestions.currentValue,
      proposedValue: profileSuggestions.proposedValue,
    });
  if (!claimed) return { ok: false, reason: "al behandeld" };

  if (claimed.fieldClass === "safe") {
    await applyChefSafeField({
      chefId: claimed.chefId,
      field: claimed.field,
      value: claimed.proposedValue,
      actorUserId: args.decidedBy,
    });
    return { ok: true, field: claimed.field, applied: "saved" };
  }

  // Sensitive (vakniveau).
  if (args.actorKind === "owner") {
    await db
      .update(chefs)
      .set({ vakniveau: claimed.proposedValue as never, updatedAt: new Date() })
      .where(eq(chefs.id, claimed.chefId));
    await recordAuditCore({
      userId: args.decidedBy,
      action: "chef.profile_updated",
      resource: "chefs",
      resourceId: claimed.chefId,
      after: { vakniveau: claimed.proposedValue, via: "ai_suggestion_owner" },
    });
    return { ok: true, field: claimed.field, applied: "saved" };
  }

  // Chef accepting a sensitive field → owner-approval rail.
  await db.insert(profileChangeRequests).values({
    chefId: claimed.chefId,
    field: "vakniveau",
    currentValue: claimed.currentValue as never,
    proposedValue: claimed.proposedValue as never,
    reason: "Voorgesteld op basis van mijn CV",
  });
  return { ok: true, field: claimed.field, applied: "requested" };
}

export async function dismissSuggestion(args: {
  suggestionId: string;
  decidedBy: string;
  expectChefId?: string;
}): Promise<{ ok: boolean }> {
  const [row] = await db
    .update(profileSuggestions)
    .set({ status: "dismissed", decidedBy: args.decidedBy, decidedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(profileSuggestions.id, args.suggestionId),
        eq(profileSuggestions.status, "pending"),
        args.expectChefId ? eq(profileSuggestions.chefId, args.expectChefId) : undefined,
      ),
    )
    .returning({ id: profileSuggestions.id });
  return { ok: Boolean(row) };
}
