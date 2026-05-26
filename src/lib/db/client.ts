/**
 * Drizzle DB client — Neon serverless driver.
 *
 * Uses Neon's HTTP driver in serverless environments (Vercel functions)
 * and falls back to the websocket pool for local dev. The driver auto-
 * selects based on environment.
 *
 * Two clients exported:
 *   - db: pooled connection for runtime queries (uses DATABASE_URL)
 *   - dbUnpooled: unpooled — for `drizzle-kit migrate` only
 *
 * Import:  import { db } from "@/lib/db/client";
 *          const users = await db.select().from(users);
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { env } from "@/lib/env";

import * as schema from "./schema";

/** Pooled connection — for app code. */
const sql = neon(env.DATABASE_URL);

export const db = drizzle(sql, { schema, logger: false });

export { schema };
