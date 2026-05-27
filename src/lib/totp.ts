/**
 * TOTP (RFC 6238) helpers + AES-256-GCM encryption of the shared secret.
 *
 * PR-S2A enrollment + PR-S2B/E challenge. Edge-runtime-safe (Web Crypto
 * API only — no node:crypto) because auth.ts pulls this into the
 * middleware bundle indirectly.
 *
 * Encryption format (stored in users.totp_secret_encrypted):
 *   base64( iv[12] || ciphertext+authTag )
 *
 * Web Crypto's AES-GCM concatenates ciphertext + 16-byte auth tag.
 *
 * Key derivation: SHA-256 hash of TOTP_ENCRYPTION_KEY → 32 bytes
 * (AES-256). Any string ≥32 chars works as the env var; recommended
 * is `openssl rand -base64 32`.
 */

import * as OTPAuth from "otpauth";
import { toDataURL } from "qrcode";

const ALG: AesGcmParams["name"] = "AES-GCM";
const IV_LEN = 12;
const ISSUER = "Chef & Serve";

function getRawKey(): string {
  const k = process.env.TOTP_ENCRYPTION_KEY;
  if (!k) {
    throw new Error(
      "TOTP_ENCRYPTION_KEY is not set. Generate one via " +
        "`openssl rand -base64 32` and add to Vercel env.",
    );
  }
  return k;
}

let cachedKey: Promise<CryptoKey> | null = null;
function getAesKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  cachedKey = (async () => {
    // Derive 32-byte key via SHA-256 of the env var
    const raw = new TextEncoder().encode(getRawKey());
    const digest = await crypto.subtle.digest("SHA-256", raw);
    return crypto.subtle.importKey(
      "raw",
      digest,
      { name: ALG, length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  })();
  return cachedKey;
}

/* ---------- secret generation ---------------------------------------- */

/** Generate a fresh TOTP secret in base32 (suitable for QR provisioning). */
export function generateSecret(): string {
  // OTPAuth.Secret() produces a random 20-byte secret; .base32 is the standard
  // form used by authenticator apps.
  return new OTPAuth.Secret({ size: 20 }).base32;
}

/* ---------- AES-256-GCM symmetric encryption ------------------------- */

function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  // btoa is available in Edge + Node 18+
  return btoa(s);
}

function base64ToBuf(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function encryptSecret(plaintextBase32: string): Promise<string> {
  const key = await getAesKey();
  const iv = new Uint8Array(IV_LEN);
  crypto.getRandomValues(iv);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: ALG, iv },
    key,
    new TextEncoder().encode(plaintextBase32),
  );
  const cipherBytes = new Uint8Array(cipherBuf);
  const combined = new Uint8Array(iv.length + cipherBytes.length);
  combined.set(iv, 0);
  combined.set(cipherBytes, iv.length);
  return bufToBase64(combined);
}

export async function decryptSecret(encrypted: string): Promise<string> {
  const all = base64ToBuf(encrypted);
  if (all.length < IV_LEN + 16 + 1) {
    throw new Error("encrypted TOTP secret too short — likely corrupted");
  }
  const iv = all.slice(0, IV_LEN);
  const ciphertext = all.slice(IV_LEN);
  const key = await getAesKey();
  // Copy ciphertext to a fresh ArrayBuffer so TS doesn't complain about
  // possibly-shared ArrayBufferLike.
  const buf = await crypto.subtle.decrypt(
    { name: ALG, iv },
    key,
    ciphertext.slice().buffer,
  );
  return new TextDecoder().decode(buf);
}

/* ---------- TOTP code verify ----------------------------------------- */

/**
 * Validate a 6-digit code against the stored secret.
 * window=1 → accept previous + current + next 30-second step (±30s drift).
 */
export function verifyCode(
  secretBase32: string,
  code: string,
  window = 1,
): boolean {
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secretBase32),
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  });
  return totp.validate({ token: code.replace(/\s+/g, ""), window }) !== null;
}

/* ---------- QR provisioning URI -------------------------------------- */

export function buildProvisioningUri(args: {
  secretBase32: string;
  accountEmail: string;
}): string {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: args.accountEmail,
    secret: OTPAuth.Secret.fromBase32(args.secretBase32),
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  });
  return totp.toString();
}

/** Render the provisioning URI as a base64 data: PNG for inline display. */
export async function buildQrDataUrl(provisioningUri: string): Promise<string> {
  return toDataURL(provisioningUri, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 240,
  });
}
