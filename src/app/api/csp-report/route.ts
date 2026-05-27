/**
 * CSP violation reporter — PR-S1D.
 *
 * Receives reports from browsers when our Content-Security-Policy-Report-Only
 * header would have blocked a resource. Each report is written to error_log
 * at severity 'info' so we can build the allowlist before flipping CSP to
 * enforce mode.
 *
 * Browsers POST with content-type `application/csp-report` (legacy) or
 * `application/reports+json` (Reporting API). We accept both.
 *
 * Response is always 204 — we never tell the browser anything went wrong;
 * silent absorption is the spec.
 */

import { db } from "@/lib/db/client";
import { errorLog } from "@/lib/db/schema";

type LegacyReport = {
  "csp-report"?: {
    "document-uri"?: string;
    "violated-directive"?: string;
    "blocked-uri"?: string;
    "original-policy"?: string;
    referrer?: string;
    disposition?: "enforce" | "report";
  };
};

type ReportingApiReport = {
  type?: string;
  url?: string;
  body?: {
    blockedURL?: string;
    documentURL?: string;
    effectiveDirective?: string;
    originalPolicy?: string;
    disposition?: "enforce" | "report";
    referrer?: string;
  };
};

export async function POST(request: Request): Promise<Response> {
  try {
    // Cap body size so a malicious reporter can't flood us
    const text = await request.text();
    if (text.length > 16 * 1024) {
      return new Response(null, { status: 204 });
    }

    const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
    let documentUri: string | undefined;
    let violatedDirective: string | undefined;
    let blockedUri: string | undefined;
    let disposition: string | undefined;

    if (parsed && typeof parsed === "object") {
      const legacy = parsed as LegacyReport;
      if (legacy["csp-report"]) {
        const r = legacy["csp-report"];
        documentUri = r["document-uri"];
        violatedDirective = r["violated-directive"];
        blockedUri = r["blocked-uri"];
        disposition = r.disposition;
      } else if (Array.isArray(parsed)) {
        // Reporting API sends an array of reports
        const first = (parsed as ReportingApiReport[])[0];
        if (first && first.body) {
          documentUri = first.body.documentURL;
          violatedDirective = first.body.effectiveDirective;
          blockedUri = first.body.blockedURL;
          disposition = first.body.disposition;
        }
      }
    }

    // Skip if we couldn't parse anything useful — most likely an empty
    // beacon from a stale browser tab. Don't pollute error_log.
    if (!violatedDirective && !blockedUri) {
      return new Response(null, { status: 204 });
    }

    await db
      .insert(errorLog)
      .values({
        message: `CSP report: ${violatedDirective ?? "unknown directive"} blocked ${blockedUri ?? "unknown"}`,
        severity: "info",
        url: documentUri ?? null,
        context: {
          csp: true,
          violatedDirective,
          blockedUri,
          disposition,
        },
      })
      .catch(() => {
        /* never block the report endpoint on DB failure */
      });
  } catch {
    /* parse failure — silently absorb */
  }

  return new Response(null, { status: 204 });
}
