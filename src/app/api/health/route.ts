/**
 * Public health endpoint.
 *
 * GET /api/health → 200 with JSON describing component status.
 *
 * Used by:
 *   - Uptime monitoring (BetterUptime / Pingdom / similar)
 *   - Railway worker liveness check on deploy
 *   - Manual debugging when something feels off
 *
 * Returns NO secrets and NO PII — only "is the service reachable +
 * configured" booleans. Safe to expose publicly.
 *
 * HTTP status:
 *   - 200 if DB ping works (the only hard dependency)
 *   - 503 if DB ping fails (everything else degrades gracefully)
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { env } from "@/lib/env";
import { r2IsConfigured } from "@/lib/r2";

export const dynamic = "force-dynamic"; // never cache — always live
export const runtime = "nodejs";

type ComponentStatus = "ok" | "missing" | "error";

type HealthResponse = {
  status: "healthy" | "degraded" | "down";
  timestamp: string;
  components: {
    database: ComponentStatus;
    email: ComponentStatus;
    storage: ComponentStatus;
    auth: ComponentStatus;
  };
  env: "development" | "preview" | "production";
};

export async function GET() {
  const components: HealthResponse["components"] = {
    database: "error",
    email: env.RESEND_API_KEY ? "ok" : "missing",
    storage: r2IsConfigured() ? "ok" : "missing",
    auth: env.AUTH_SECRET ? "ok" : "missing",
  };

  // DB ping — the only check that does I/O
  try {
    await db.execute(sql`SELECT 1`);
    components.database = "ok";
  } catch {
    components.database = "error";
  }

  const dbHealthy = components.database === "ok";
  const allConfigured = Object.values(components).every((s) => s === "ok");

  const body: HealthResponse = {
    status: !dbHealthy ? "down" : allConfigured ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    components,
    env: env.VERCEL_ENV,
  };

  return NextResponse.json(body, {
    status: dbHealthy ? 200 : 503,
    headers: {
      "cache-control": "no-store, max-age=0",
    },
  });
}
