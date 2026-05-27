/**
 * External-refs helper — PR-CHEF-0.
 *
 * One canonical place that maps Chef & Serve entities to external system IDs:
 *   - chefs.id ↔ payingit employee id
 *   - clients.id ↔ accounting customer id
 *   - shift_hours.id ↔ payroll batch line id
 *   - payroll_batches.id ↔ external batch ref
 *
 * Rule: never put external IDs as columns on entity tables. They go here so
 * we can add new providers without schema churn.
 */

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { externalRefs } from "@/lib/db/schema";

export type UpsertExternalRefArgs = {
  provider: string;
  entityType: string;
  entityId: string;
  externalId: string;
  externalUrl?: string;
  meta?: Record<string, unknown>;
};

/**
 * Upsert by (provider, entityType, entityId). The UNIQUE index on those
 * three columns is enforced by the migration.
 */
export async function upsertExternalRef(
  args: UpsertExternalRefArgs,
): Promise<void> {
  await db
    .insert(externalRefs)
    .values({
      provider: args.provider,
      entityType: args.entityType,
      entityId: args.entityId,
      externalId: args.externalId,
      externalUrl: args.externalUrl,
      metaJson: args.meta as never,
    })
    .onConflictDoUpdate({
      target: [externalRefs.provider, externalRefs.entityType, externalRefs.entityId],
      set: {
        externalId: args.externalId,
        externalUrl: args.externalUrl,
        metaJson: args.meta as never,
        updatedAt: new Date(),
      },
    });
}

/** Look up the external id for a given internal entity + provider. */
export async function resolveExternalRef(args: {
  provider: string;
  entityType: string;
  entityId: string;
}): Promise<{ externalId: string; externalUrl: string | null } | null> {
  const [row] = await db
    .select({
      externalId: externalRefs.externalId,
      externalUrl: externalRefs.externalUrl,
    })
    .from(externalRefs)
    .where(
      and(
        eq(externalRefs.provider, args.provider),
        eq(externalRefs.entityType, args.entityType),
        eq(externalRefs.entityId, args.entityId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Reverse lookup — find our internal entityId from an external id. */
export async function resolveByExternalId(args: {
  provider: string;
  entityType: string;
  externalId: string;
}): Promise<{ entityId: string } | null> {
  const [row] = await db
    .select({ entityId: externalRefs.entityId })
    .from(externalRefs)
    .where(
      and(
        eq(externalRefs.provider, args.provider),
        eq(externalRefs.entityType, args.entityType),
        eq(externalRefs.externalId, args.externalId),
      ),
    )
    .limit(1);
  return row ?? null;
}
