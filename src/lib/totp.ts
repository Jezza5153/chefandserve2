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

import { makeCipher } from "@/lib/crypto";

const ISSUER = "Chef & Serve";

/**
 * The TOTP-secret cipher. Bound to TOTP_ENCRYPTION_KEY via a static getter so
 * Next inlines the env reference for the middleware/edge bundle. Same algorithm,
 * format, and key as before the src/lib/crypto.ts extraction (PR-FB-0) — existing
 * stored `users.totp_secret_encrypted` values keep decrypting unchanged.
 */
const totpCipher = makeCipher(() => process.env.TOTP_ENCRYPTION_KEY, "TOTP_ENCRYPTION_KEY");

/* ---------- secret generation ---------------------------------------- */

/** Generate a fresh TOTP secret in base32 (suitable for QR provisioning). */
export function generateSecret(): string {
  // OTPAuth.Secret() produces a random 20-byte secret; .base32 is the standard
  // form used by authenticator apps.
  return new OTPAuth.Secret({ size: 20 }).base32;
}

/* ---------- AES-256-GCM symmetric encryption ------------------------- */
// Delegated to the shared cipher in src/lib/crypto.ts (extracted PR-FB-0).
// Format/algorithm/key unchanged, so previously-stored secrets still decrypt.

/** Encrypt a base32 TOTP secret for storage in users.totp_secret_encrypted. */
export function encryptSecret(plaintextBase32: string): Promise<string> {
  return totpCipher.encrypt(plaintextBase32);
}

/** Decrypt a stored TOTP secret back to base32. */
export function decryptSecret(encrypted: string): Promise<string> {
  return totpCipher.decrypt(encrypted);
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
