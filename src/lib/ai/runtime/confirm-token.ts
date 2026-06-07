/**
 * Stateless, forge-proof confirmation tokens.
 *
 * When the assistant proposes an outbound/financial action it mints a token bound to
 * the exact {tool, inputs, requesting human}. The channel shows the human a confirm
 * gesture (dashboard button / WhatsApp quick-reply / spoken "ja") that echoes the
 * token back. Only the server (holding the secret) can mint a valid token, so the LLM
 * cannot self-approve. No DB row needed — verification recomputes the HMAC.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_MS = 10 * 60_000; // 10 minutes

/** Content hash of the tool inputs — order-independent, so the same logical args always match. */
export function hashInput(input: unknown): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex").slice(0, 32);
}

export type ConfirmTokenArgs = {
  tool: string;
  inputHash: string;
  actorUserId: string;
  secret: string;
  now?: number;
  ttlMs?: number;
};

export function mintConfirmToken(a: ConfirmTokenArgs): string {
  const ttl = a.ttlMs ?? DEFAULT_TTL_MS;
  const now = a.now ?? Date.now();
  const bucket = Math.floor(now / ttl);
  return `${bucket}.${sign(a.secret, payload(a.tool, a.inputHash, a.actorUserId, bucket))}`;
}

export function verifyConfirmToken(a: ConfirmTokenArgs & { token: string }): boolean {
  const ttl = a.ttlMs ?? DEFAULT_TTL_MS;
  const now = a.now ?? Date.now();
  const dot = a.token.indexOf(".");
  if (dot <= 0) return false;
  const bucket = Number(a.token.slice(0, dot));
  const sig = a.token.slice(dot + 1);
  if (!Number.isInteger(bucket) || sig.length === 0) return false;
  const current = Math.floor(now / ttl);
  // accept the current window and the one just before it (clock drift / propose→confirm latency)
  if (bucket !== current && bucket !== current - 1) return false;
  return safeEqualHex(sig, sign(a.secret, payload(a.tool, a.inputHash, a.actorUserId, bucket)));
}

function payload(tool: string, inputHash: string, actorUserId: string, bucket: number): string {
  return `${tool}|${inputHash}|${actorUserId}|${bucket}`;
}

function sign(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}
