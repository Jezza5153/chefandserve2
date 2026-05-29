/**
 * Interactive-transaction client — Neon WebSocket (`drizzle-orm/neon-serverless`).
 *
 * The default `db` (neon-http) has NO interactive transactions, so use THIS only
 * where a mutation and its `audit_log` row must commit atomically — the
 * high-risk set (see the "withTx forward rule" in
 * `docs/ai/ai-audit-and-logging.md`). Everything else uses the fast HTTP `db`.
 *
 * V1: a pool is created + ended PER CALL. Simple + safe for the small high-risk
 * set; if latency is ever felt (e.g. frequent placement-status changes), move to
 * a carefully lifecycle-managed singleton pool — do NOT optimize prematurely.
 *
 * EDGE SAFETY: this module pulls `ws` + the WebSocket Pool, so it must NEVER be
 * imported from middleware / the edge bundle. (It isn't — middleware only imports
 * the pure `@/lib/impersonation-denylist`.)
 */

import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";

import { env } from "@/lib/env";

import * as schema from "./schema";

// Node (Vercel) has no global WebSocket before v22 — give the driver one.
if (!(globalThis as { WebSocket?: unknown }).WebSocket) {
  neonConfig.webSocketConstructor = ws;
}

// Fail LOUD if pointed at the pooled/PgBouncer endpoint: interactive
// transactions need the DIRECT (unpooled) host or they silently misbehave.
if (env.DATABASE_URL_UNPOOLED.includes("-pooler")) {
  throw new Error(
    "DATABASE_URL_UNPOOLED must NOT be a Neon -pooler host — interactive transactions need the direct endpoint.",
  );
}

/** The transaction handle passed to a {@link withTx} callback. */
export type TxConn = Parameters<
  Parameters<NeonDatabase<typeof schema>["transaction"]>[0]
>[0];

/**
 * Run `fn` inside ONE interactive transaction. Commits when `fn` resolves; rolls
 * back if it throws.
 *
 * The callback must contain ONLY DB work — the mutation, the audit insert, and
 * the pure data prep for those. Keep `redirect()` / `notFound()` /
 * `revalidatePath()` / email / outbox / notifications OUTSIDE it: Next's
 * `redirect()` throws, and a throw rolls the transaction back.
 */
export async function withTx<T>(fn: (tx: TxConn) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: env.DATABASE_URL_UNPOOLED, max: 1 });
  try {
    return await drizzle(pool, { schema }).transaction(fn);
  } finally {
    await pool.end(); // MUST be in finally, else a thrown tx leaks a connection
  }
}
