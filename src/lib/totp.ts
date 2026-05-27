/**
 * TOTP (RFC 6238) helpers + AES-256-GCM encryption of the shared secret.
 *
 * PR-S2A: enrollment surface only. PR-S2B/S2C use these to actually
 * challenge sign-in.
 *
 * Encryption format (stored in users.totp_secret_encrypted):
 *   base64( iv[12] || ciphertext || authTag[16] )
 *
 * Key derivation: AES-256 uses 32 bytes. We take the first 32 bytes of
 * sha-256(TOTP_ENCRYPTION_KEY) — so any string ≥32 chars works as the
 * env var. (Plain base64 of 32 random bytes is the recommended format.)
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import * as OTPAuth from "otpauth";
import { toDataURL } from "qrcode";

import { env } from "@/lib/env";

const ALG = "aes-256-gcm";
const IV_LEN = 12;       // GCM standard
const TAG_LEN = 16;      // GCM standard
const ISSUER = "Chef & Serve";

function getKey(): Buffer {
  if (!env.TOTP_ENCRYPTION_KEY) {
    throw new Error(
      "TOTP_ENCRYPTION_KEY is not set. Generate one via " +
        "`openssl rand -base64 32` and add to Vercel env (production + " +
        "preview + development).",
    );
  }
  // Hash any length input down to the 32 bytes AES-256 needs.
  return createHash("sha256").update(env.TOTP_ENCRYPTION_KEY).digest();
}

/* ---------- secret generation ---------------------------------------- */

/** Generate a fresh TOTP secret in base32 (suitable for QR provisioning). */
export function generateSecret(): string {
  // OTPAuth.Secret() produces a random 20-byte secret; .base32 is the standard
  // form used by authenticator apps.
  return new OTPAuth.Secret({ size: 20 }).base32;
}

/* ---------- AES-256-GCM symmetric encryption ------------------------- */

export function encryptSecret(plaintextBase32: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintextBase32, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString("base64");
}

export function decryptSecret(encrypted: string): string {
  const buf = Buffer.from(encrypted, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("encrypted TOTP secret too short — likely corrupted");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv(ALG, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
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
  // .validate returns delta within window, or null on mismatch.
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
