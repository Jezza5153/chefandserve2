/**
 * Jotform webhook payload extractor.
 *
 * Jotform posts as `application/x-www-form-urlencoded` with these key fields:
 *   - submissionID         — Jotform's submission UUID (idempotency key)
 *   - formID               — which form
 *   - rawRequest           — JSON-encoded string of all answers, keyed by Jotform field id
 *   - pretty               — human-readable "label: value" pairs (comma-separated)
 *   - formTitle, ip, …     — metadata
 *
 * The Jotform field IDs (`q3_naam`, `q4_email`, etc.) are stable per form but
 * unknowable without the form definition. So we extract loosely: search by
 * keyword in the `pretty` string, fall back to `rawRequest` JSON, fall back to
 * empty. This is intentionally permissive — webhooks are append-only-source,
 * we'd rather store messy than lose data.
 *
 * Maarten can edit + re-categorise via the inbox UI later.
 */

import type { NewChefSubmission, NewClientSubmission } from "@/lib/db/schema";

export type JotformBody = Record<string, string | string[] | undefined>;

/** Parse `rawRequest` field — Jotform encodes it as a JSON string. Safe-default to {}. */
function parseRawRequest(body: JotformBody): Record<string, unknown> {
  const raw = body.rawRequest;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Search the `pretty` string for a labelled value.
 * Jotform's `pretty` format: "Label: value, NextLabel: value, …"
 *
 * Returns `null` if no match — caller can fall back to rawRequest or skip.
 */
function fromPretty(pretty: string | undefined, labelKeywords: string[]): string | null {
  if (!pretty) return null;
  // Split on commas, then try each label match
  const parts = pretty.split(",").map((p) => p.trim());
  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) continue;
    const label = part.slice(0, colonIdx).toLowerCase();
    const value = part.slice(colonIdx + 1).trim();
    if (labelKeywords.some((kw) => label.includes(kw.toLowerCase()))) {
      return value || null;
    }
  }
  return null;
}

/**
 * Search rawRequest object for a value by key keywords. Jotform field keys look
 * like `q3_naam`, `q5_email`, `q12_telefoon` etc. We search by suffix keyword.
 */
function fromRawRequest(
  raw: Record<string, unknown>,
  keyKeywords: string[],
): string | null {
  for (const [k, v] of Object.entries(raw)) {
    const lower = k.toLowerCase();
    if (!keyKeywords.some((kw) => lower.includes(kw.toLowerCase()))) continue;
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "object" && v !== null) {
      // Jotform sometimes nests (e.g. name = { first, last }, address = { addr_line1, … })
      const flat = Object.values(v as Record<string, unknown>)
        .filter((x): x is string => typeof x === "string" && x.trim() !== "")
        .join(" ")
        .trim();
      if (flat) return flat;
    }
  }
  return null;
}

/** Convenience: try pretty first, then raw, then return null. */
function extract(
  body: JotformBody,
  raw: Record<string, unknown>,
  prettyKeywords: string[],
  rawKeywords: string[],
): string | null {
  const pretty = typeof body.pretty === "string" ? body.pretty : undefined;
  return (
    fromPretty(pretty, prettyKeywords) ?? fromRawRequest(raw, rawKeywords) ?? null
  );
}

function toInt(s: string | null): number | null {
  if (!s) return null;
  const n = parseInt(s.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function lowerEmail(s: string | null): string | null {
  return s ? s.trim().toLowerCase() : null;
}

/**
 * Map a Jotform chef-intake payload to a chef_submissions row.
 * Required: externalId (submissionID) — caller throws if missing.
 */
export function extractChefSubmission(
  body: JotformBody,
): Omit<NewChefSubmission, "id" | "createdAt" | "updatedAt"> {
  const externalId = String(body.submissionID ?? "").trim();
  if (!externalId) {
    throw new Error("Jotform payload missing submissionID");
  }
  const raw = parseRawRequest(body);

  return {
    externalId,
    source: "jotform",
    rawPayload: body as Record<string, unknown>,
    fullName: extract(body, raw, ["naam", "name"], ["naam", "name"]),
    email: lowerEmail(extract(body, raw, ["email", "e-mail"], ["email"])),
    phone: extract(
      body,
      raw,
      ["telefoon", "phone", "tel"],
      ["telefoon", "phone", "tel"],
    ),
    rolesRequested: extract(
      body,
      raw,
      ["rol", "role", "functie", "positie"],
      ["rol", "role", "functie", "positie"],
    ),
    yearsExperience: toInt(
      extract(body, raw, ["ervaring", "experience", "jaren"], ["ervaring", "years"]),
    ),
    locationPreference: extract(
      body,
      raw,
      ["locatie", "location", "regio"],
      ["locatie", "location", "regio"],
    ),
    notes: extract(
      body,
      raw,
      ["bericht", "opmerking", "notes", "message", "comment"],
      ["bericht", "opmerking", "notes", "message", "comment"],
    ),
    status: "new",
  };
}

/**
 * Map a Jotform client-intake payload to a client_submissions row.
 */
export function extractClientSubmission(
  body: JotformBody,
): Omit<NewClientSubmission, "id" | "createdAt" | "updatedAt"> {
  const externalId = String(body.submissionID ?? "").trim();
  if (!externalId) {
    throw new Error("Jotform payload missing submissionID");
  }
  const raw = parseRawRequest(body);

  return {
    externalId,
    source: "jotform",
    rawPayload: body as Record<string, unknown>,
    companyName: extract(
      body,
      raw,
      ["bedrijf", "company", "locatie", "hotel", "restaurant"],
      ["bedrijf", "company"],
    ),
    contactName: extract(body, raw, ["naam", "name"], ["naam", "name"]),
    email: lowerEmail(extract(body, raw, ["email", "e-mail"], ["email"])),
    phone: extract(
      body,
      raw,
      ["telefoon", "phone", "tel"],
      ["telefoon", "phone", "tel"],
    ),
    roleRequested: extract(
      body,
      raw,
      ["rol", "role", "functie", "personeel"],
      ["rol", "role", "functie", "personeel"],
    ),
    segment: extract(
      body,
      raw,
      ["segment", "type", "categorie"],
      ["segment", "type", "categorie"],
    ),
    dateNeeded: extract(
      body,
      raw,
      ["datum", "date", "wanneer", "periode"],
      ["datum", "date", "wanneer", "periode"],
    ),
    headcount: toInt(
      extract(
        body,
        raw,
        ["aantal", "headcount", "personen", "hoeveel"],
        ["aantal", "headcount", "personen"],
      ),
    ),
    location: extract(
      body,
      raw,
      ["adres", "address", "locatie", "stad"],
      ["adres", "address", "locatie", "stad"],
    ),
    notes: extract(
      body,
      raw,
      ["bericht", "opmerking", "notes", "message", "bijzonderheden"],
      ["bericht", "opmerking", "notes", "message", "bijzonderheden"],
    ),
    status: "new",
  };
}
