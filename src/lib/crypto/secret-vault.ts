/**
 * Symmetric secret vault — encrypt/decrypt values that must round-trip through
 * the DB (e.g. the Discord bot token an admin pastes into the settings page).
 *
 * Choices:
 *  - AES-256-GCM (authenticated encryption — tamper detection comes for free).
 *  - Master key derived from `BETTER_AUTH_SECRET` via HKDF-SHA256, so there's no
 *    new env var to rotate. Rotating BETTER_AUTH_SECRET would invalidate every
 *    encrypted Discord token; document that on the rotation runbook (operators
 *    re-paste the bot token after rotation).
 *  - Storage format `v1:base64(iv).base64(ciphertext).base64(authTag)`. The
 *    leading `v1:` makes a future algorithm change forward-compatible.
 *  - Random 96-bit IV per encryption (NIST-recommended for GCM).
 *
 * Plain `src/lib/*` module (no "use server"), so it can be imported anywhere
 * without re-export crashes (see CLAUDE.md).
 */
import crypto from "crypto";
import { env } from "@/env";

const ALG = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const FORMAT_PREFIX = "v1:";
const HKDF_INFO = Buffer.from("discord-secret-vault.v1");
const HKDF_SALT = Buffer.from("gearflow.discord-token");

let cachedKey: Buffer | null = null;
function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const ikm = Buffer.from(env.BETTER_AUTH_SECRET, "utf8");
  cachedKey = Buffer.from(crypto.hkdfSync("sha256", ikm, HKDF_SALT, HKDF_INFO, KEY_LEN));
  return cachedKey;
}

/** Reset the derived key cache (test helper). */
export function _resetSecretVaultCache(): void {
  cachedKey = null;
}

export class SecretVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretVaultError";
  }
}

/** Encrypt a string. Empty input → empty output (so callers can store unset secrets as ""). */
export function encryptSecret(plain: string): string {
  if (plain === "") return "";
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${FORMAT_PREFIX}${iv.toString("base64")}.${ct.toString("base64")}.${tag.toString("base64")}`;
}

/** Decrypt a vault-encoded string. Throws on tamper / wrong key / malformed input. */
export function decryptSecret(encoded: string): string {
  if (encoded === "") return "";
  if (!encoded.startsWith(FORMAT_PREFIX)) {
    throw new SecretVaultError("Unrecognized secret format (missing v1: prefix)");
  }
  const body = encoded.slice(FORMAT_PREFIX.length);
  const parts = body.split(".");
  if (parts.length !== 3) {
    throw new SecretVaultError("Malformed secret payload (expected iv.ct.tag)");
  }
  const [ivB64, ctB64, tagB64] = parts;
  let iv: Buffer, ct: Buffer, tag: Buffer;
  try {
    iv = Buffer.from(ivB64!, "base64");
    ct = Buffer.from(ctB64!, "base64");
    tag = Buffer.from(tagB64!, "base64");
  } catch {
    throw new SecretVaultError("Malformed secret payload (base64 decode failed)");
  }
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new SecretVaultError("Malformed secret payload (iv/tag length mismatch)");
  }
  const decipher = crypto.createDecipheriv(ALG, masterKey(), iv);
  decipher.setAuthTag(tag);
  try {
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    throw new SecretVaultError("Secret decrypt failed (tampered or wrong key)");
  }
}

/** True if the value looks like a vault-encoded string (no decrypt attempt). */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(FORMAT_PREFIX);
}
