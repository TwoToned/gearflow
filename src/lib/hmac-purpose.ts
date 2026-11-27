/**
 * Purpose-separated HMAC for the app's signed tokens. Every signed token in the
 * app was keyed off the same `BETTER_AUTH_SECRET`, so a signature minted for one
 * purpose verified for another if the payload shapes ever overlapped. Now each
 * purpose gets its OWN key (HKDF-SHA256 from the secret, `info` = the purpose
 * string) and the purpose string is also inside the MAC input, so a token minted
 * for `team-undo:v1` can never verify as a `xero-oauth-state:v1` state (or any other
 * purpose), whatever its payload says.
 */
import crypto from "crypto";
import { env } from "@/env";

function purposeKey(purpose: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", env.BETTER_AUTH_SECRET, Buffer.alloc(0), purpose, 32));
}

// HMAC-SHA256 over a token payload, not a password hash.
export function signForPurpose(purpose: string, payload: string): string {
  return crypto.createHmac("sha256", purposeKey(purpose)).update(`${purpose}:${payload}`).digest("base64url"); // codeql[js/insufficient-password-hash]
}

export function verifyForPurpose(purpose: string, payload: string, signature: string): boolean {
  const sig = Buffer.from(signature, "base64url");
  const exp = Buffer.from(signForPurpose(purpose, payload), "base64url");
  return sig.length === exp.length && crypto.timingSafeEqual(sig, exp);
}
