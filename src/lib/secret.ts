import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Storing a credential that belongs to somebody else.
 *
 * A Klaviyo private key can read a client's whole customer list and send mail
 * in their name, so it is not stored the way a setting is. It is encrypted with
 * a key that lives in the environment rather than the database: a dump of the
 * database on its own then contains nothing usable, which is the property worth
 * having, because a database is the thing that gets copied to a laptop for
 * debugging and a backup bucket by a cron job.
 *
 * AES-256-GCM rather than CBC because GCM authenticates as well as encrypts --
 * a ciphertext altered in the database fails to decrypt rather than decrypting
 * to something else.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the size GCM is defined for
const VERSION = "v1";

export class SecretError extends Error {}

/**
 * The environment's key, as 32 bytes.
 *
 * Deliberately loud when it is missing or the wrong size. The alternative --
 * falling back to a built-in default so the app keeps working -- would store
 * every client's key under a passphrase that is in the source code, which is
 * worse than not storing them at all.
 */
function key(): Buffer {
  const raw = (process.env.ENCRYPTION_KEY ?? "").trim();
  if (!raw) {
    throw new SecretError(
      "ENCRYPTION_KEY is not set, so credentials cannot be stored. Generate one with " +
        "`openssl rand -base64 32` and set it in the environment.",
    );
  }

  const bytes = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (bytes.length !== 32) {
    throw new SecretError(
      `ENCRYPTION_KEY must decode to 32 bytes, but it decodes to ${bytes.length}. ` +
        "Generate one with `openssl rand -base64 32`.",
    );
  }
  return bytes;
}

/** Whether credentials can be stored at all, for telling someone before they type one in. */
export function secretsAvailable(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, body] = (stored ?? "").split(".");
  if (version !== VERSION || !iv || !tag || !body) {
    throw new SecretError("Stored credential is not in a format this build understands.");
  }
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Either the ciphertext was altered or ENCRYPTION_KEY has changed since it
    // was written. Both mean the same thing to whoever is looking at it: the
    // stored key is no longer usable and has to be entered again.
    throw new SecretError(
      "Stored credential could not be decrypted. If ENCRYPTION_KEY was changed, the key has to be re-entered.",
    );
  }
}

/**
 * What a stored credential is allowed to look like on screen.
 *
 * Never the key itself, not even to the person who typed it: an API key is
 * write-only from the app's point of view. The last four characters are enough
 * to tell two keys apart, which is the only question anyone actually asks of
 * it -- "is this the one I think it is".
 */
export function secretHint(plain: string): string {
  const clean = plain.trim();
  return clean.length <= 4 ? "••••" : `••••${clean.slice(-4)}`;
}

/** Compare without leaking, for the rare case two secrets are checked for equality. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
