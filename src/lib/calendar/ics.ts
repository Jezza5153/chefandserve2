/**
 * ICS calendar feed builder — PR-CHEF-11.
 *
 * Minimal RFC 5545 compliant generator. No deps — RFC 5545 is small
 * enough to hand-roll for our needs (shift events only, no recurrence,
 * no attendees, no alarms).
 *
 * Output is consumed by iOS Calendar / Google Calendar / Outlook
 * subscribe-by-URL. Cancel a placement → next sync removes the event
 * thanks to STATUS:CANCELLED.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type IcsEvent = {
  uid: string;          // Stable per placement, e.g. "placement-<id>@chefandserve.nl"
  summary: string;
  description?: string;
  location?: string;
  startsAt: Date;
  endsAt: Date;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toIcsUtc(d: Date): string {
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escape(s: string): string {
  // RFC 5545: backslash, comma, semicolon, newline must be escaped.
  return s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

function fold(line: string): string {
  // Lines >75 octets must be folded (continuation line starts with space).
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let i = 0;
  while (i < line.length) {
    chunks.push(line.slice(i, i + 75));
    i += 75;
  }
  return chunks.join("\r\n ");
}

export function buildIcs(args: {
  calendarName: string;
  events: IcsEvent[];
}): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Chef en Serve//Chef Portal//NL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escape(args.calendarName)}`,
    "X-WR-TIMEZONE:Europe/Amsterdam",
  ];

  for (const e of args.events) {
    lines.push("BEGIN:VEVENT");
    lines.push(fold(`UID:${e.uid}`));
    lines.push(`DTSTAMP:${toIcsUtc(new Date())}`);
    lines.push(`DTSTART:${toIcsUtc(e.startsAt)}`);
    lines.push(`DTEND:${toIcsUtc(e.endsAt)}`);
    lines.push(`STATUS:${e.status}`);
    lines.push(fold(`SUMMARY:${escape(e.summary)}`));
    if (e.description) lines.push(fold(`DESCRIPTION:${escape(e.description)}`));
    if (e.location) lines.push(fold(`LOCATION:${escape(e.location)}`));
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/**
 * Derive the public-URL token from the user's secret. We use HMAC-SHA256
 * so revealing the token doesn't reveal the secret, and we never store
 * the token (deterministic from the secret).
 *
 * Format: `<userId>-<hex8>` where hex8 = first 8 hex chars of HMAC.
 * Compact (16 chars total-ish) and easy to spot in URLs.
 */
export function deriveCalendarToken(args: {
  userId: string;
  secret: string;
}): string {
  const hmac = createHmac("sha256", args.secret).update(args.userId).digest("hex");
  return `${args.userId}.${hmac.slice(0, 32)}`;
}

/**
 * Constant-time validation. Returns null on mismatch, userId on success.
 */
export function parseCalendarToken(args: {
  token: string;
  lookupSecret: (userId: string) => Promise<string | null>;
}): Promise<string | null> {
  return (async () => {
    const dot = args.token.indexOf(".");
    if (dot < 1) return null;
    const userId = args.token.slice(0, dot);
    const provided = args.token.slice(dot + 1);
    const secret = await args.lookupSecret(userId);
    if (!secret) return null;
    const expected = createHmac("sha256", secret).update(userId).digest("hex").slice(0, 32);
    if (provided.length !== expected.length) return null;
    try {
      const a = Buffer.from(provided);
      const b = Buffer.from(expected);
      return timingSafeEqual(a, b) ? userId : null;
    } catch {
      return null;
    }
  })();
}

/** Generate a 32-char hex secret. Used when first issuing a feed. */
export function newCalendarSecret(): string {
  // 16 random bytes → 32 hex
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    out += buf[i].toString(16).padStart(2, "0");
  }
  return out;
}

/** Stable UID for an ICS event tied to a placement. */
export function placementUid(placementId: string): string {
  return `placement-${placementId}@chefandserve.nl`;
}

/** Used for caching/etag — content hash so calendar clients see no-change. */
export function icsEtag(ics: string): string {
  return createHash("sha256").update(ics).digest("hex").slice(0, 16);
}
