/**
 * Reusable AES-256-GCM symmetric encryption — Edge-runtime-safe (Web Crypto API
 * only, no node:crypto). Extracted from the battle-tested TOTP secret cipher
 * (PR-S2A) in PR-FB-0 so it can also protect onboarding PII at rest.
 *
 * Stored format (base64):  iv[12] || ciphertext+authTag
 * Web Crypto's AES-GCM appends the 16-byte auth tag to the ciphertext.
 *
 * Key derivation: SHA-256(rawKey) → 32 bytes (AES-256). Any string ≥32 chars
 * works as the raw key; recommended `openssl rand -base64 32`.
 *
 * Each cipher is bound to ONE raw-key source (a getter, NOT a literal) so that:
 *   - rotating the 2FA key never touches PII and vice-versa, and
 *   - the `process.env.X` reference inside the getter stays STATIC, which lets
 *     Next inline it for the middleware/edge bundle (a dynamic `process.env[x]`
 *     would read `undefined` there).
 *
 * The key is read + derived lazily on first encrypt/decrypt and cached, so
 * importing this module (or constructing a cipher) never throws — a missing key
 * only throws when that cipher is actually used. This matches the "optional
 * during the deploy window" contract in src/lib/env.ts.
 *
 * Usage:
 *   const cipher = makeCipher(() => process.env.MY_KEY, "MY_KEY");
 *   const stored = await cipher.encrypt("secret");
 *   const back   = await cipher.decrypt(stored);
 */

const ALG: AesGcmParams["name"] = "AES-GCM";
const IV_LEN = 12;
const TAG_LEN = 16;

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

export interface Cipher {
  /** Encrypt UTF-8 plaintext → base64(iv ‖ ciphertext+tag). */
  encrypt(plaintext: string): Promise<string>;
  /** Decrypt a value produced by `encrypt` back to its UTF-8 plaintext. */
  decrypt(encrypted: string): Promise<string>;
}

/**
 * Build an AES-256-GCM cipher bound to a raw-key getter.
 *
 * @param getRawKey  returns the raw key string (e.g. `() => process.env.PII_ENCRYPTION_KEY`).
 *                   Keep the `process.env.X` reference STATIC inside the arrow so
 *                   Next can inline it for the edge bundle.
 * @param label      env var name, used only in the "not set" error message.
 */
export function makeCipher(getRawKey: () => string | undefined, label: string): Cipher {
  let cachedKey: Promise<CryptoKey> | null = null;

  function getKey(): Promise<CryptoKey> {
    if (cachedKey) return cachedKey;
    cachedKey = (async () => {
      const raw = getRawKey();
      if (!raw) {
        throw new Error(
          `${label} is not set. Generate one via \`openssl rand -base64 32\` ` +
            `and add it to the environment.`,
        );
      }
      // Derive a 32-byte AES-256 key via SHA-256 of the raw key.
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
      return crypto.subtle.importKey("raw", digest, { name: ALG, length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);
    })();
    return cachedKey;
  }

  return {
    async encrypt(plaintext: string): Promise<string> {
      const key = await getKey();
      const iv = new Uint8Array(IV_LEN);
      crypto.getRandomValues(iv);
      const cipherBuf = await crypto.subtle.encrypt(
        { name: ALG, iv },
        key,
        new TextEncoder().encode(plaintext),
      );
      const cipherBytes = new Uint8Array(cipherBuf);
      const combined = new Uint8Array(iv.length + cipherBytes.length);
      combined.set(iv, 0);
      combined.set(cipherBytes, iv.length);
      return bufToBase64(combined);
    },

    async decrypt(encrypted: string): Promise<string> {
      const all = base64ToBuf(encrypted);
      if (all.length < IV_LEN + TAG_LEN + 1) {
        throw new Error("encrypted value too short — likely corrupted");
      }
      const iv = all.slice(0, IV_LEN);
      const ciphertext = all.slice(IV_LEN);
      const key = await getKey();
      // Copy ciphertext to a fresh ArrayBuffer so TS doesn't complain about a
      // possibly-shared ArrayBufferLike.
      const buf = await crypto.subtle.decrypt({ name: ALG, iv }, key, ciphertext.slice().buffer);
      return new TextDecoder().decode(buf);
    },
  };
}

/* ---------- PII cipher (onboarding: BSN / IBAN / ID number) ----------------- */

/**
 * Cipher for special-category onboarding PII stored at rest in the chefs table
 * (`bsn_encrypted`, `iban_encrypted`, `id_number_encrypted`). Bound to
 * PII_ENCRYPTION_KEY — kept separate from the 2FA key so they rotate independently.
 */
export const piiCipher = makeCipher(() => process.env.PII_ENCRYPTION_KEY, "PII_ENCRYPTION_KEY");

/** Encrypt a PII plaintext (BSN/IBAN/ID number) for storage. */
export const encryptPii = (plaintext: string): Promise<string> => piiCipher.encrypt(plaintext);

/** Decrypt a stored PII value. Server-only — never expose plaintext to the client. */
export const decryptPii = (encrypted: string): Promise<string> => piiCipher.decrypt(encrypted);
