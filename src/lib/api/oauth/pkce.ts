import { createHash, timingSafeEqual } from "crypto";

/**
 * PKCE (RFC 7636) — mandatory on every OAuth 2.1 authorization_code exchange
 * here, public client or confidential (design §14 acceptance criteria: "PKCE
 * required, no implicit flow"). `S256` only; `plain` is never accepted — the
 * schema for both the authorize request and the stored code pin
 * `code_challenge_method` to the literal `"S256"`.
 */

/** `BASE64URL(SHA256(code_verifier))`, per RFC 7636 §4.6. */
export function computeCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

/**
 * Constant-time compare of the verifier's derived challenge against the one
 * recorded at the `/authorize` step. Lengths are compared first (not a timing
 * side-channel — the challenge is a public value observable at authorization
 * time, so leaking ITS length leaks nothing about the verifier secret).
 */
export function verifyPkce(codeVerifier: string, storedCodeChallenge: string): boolean {
  const derived = Buffer.from(computeCodeChallenge(codeVerifier));
  const stored = Buffer.from(storedCodeChallenge);
  if (derived.length !== stored.length) return false;
  return timingSafeEqual(derived, stored);
}

/** A PKCE code_verifier per RFC 7636 §4.1: 43-128 chars of `[A-Za-z0-9-._~]`. */
export function isValidCodeVerifier(value: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(value);
}
