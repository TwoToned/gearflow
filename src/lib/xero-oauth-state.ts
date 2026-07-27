/**
 * Xero OAuth2 `state` param — a self-authenticating, HMAC-signed token (WS1
 * #940), NOT a bare CSRF nonce. The callback route is public (added to
 * `src/middleware.ts` publicRoutes per the issue spec, so the round-trip
 * through Xero's servers doesn't depend on the browser's session cookie
 * surviving the external redirect) — this token is what proves the request
 * really originated from an authenticated "connect Xero" click for THIS org,
 * carrying the orgId/userId the callback needs without a session.
 *
 * Format: `base64url(json payload).base64url(hmac-sha256 signature)`, keyed
 * off `BETTER_AUTH_SECRET` (same secret the secret-vault and Better Auth
 * itself already trust — no new env var to rotate). 10-minute TTL.
 */
import crypto from "crypto";
import { env } from "@/env";

const TTL_MS = 10 * 60 * 1000;

interface StatePayload {
  orgId: string;
  userId: string;
  nonce: string;
  iat: number;
}

// HMAC-SHA256 signature over a token payload, not a password hash — same
// primitive JWT's HS256 uses; verified with timingSafeEqual + a 10-min TTL.
// See file header + PR #973 review thread for the full analysis.
function sign(payload: string): string {
  return crypto.createHmac("sha256", env.BETTER_AUTH_SECRET).update(payload).digest("base64url"); // codeql[js/insufficient-password-hash]
}

export function createXeroOAuthState(orgId: string, userId: string): string {
  const payload: StatePayload = { orgId, userId, nonce: crypto.randomBytes(16).toString("hex"), iat: Date.now() };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export class XeroOAuthStateError extends Error {}

/** Verify + decode a state token. Throws XeroOAuthStateError on any
 *  tamper/expiry/malformed input — callers should treat that as "reject the
 *  callback", never fall back to trusting an unverified orgId/userId. */
export function verifyXeroOAuthState(token: string): { orgId: string; userId: string } {
  const parts = token.split(".");
  if (parts.length !== 2) throw new XeroOAuthStateError("Malformed state token.");
  const [encoded, signature] = parts;
  const expected = sign(encoded!);
  const sigBuf = Buffer.from(signature!, "base64url");
  const expBuf = Buffer.from(expected, "base64url");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new XeroOAuthStateError("State signature mismatch.");
  }
  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded!, "base64url").toString("utf8"));
  } catch {
    throw new XeroOAuthStateError("State payload is not valid JSON.");
  }
  if (typeof payload.orgId !== "string" || typeof payload.userId !== "string" || typeof payload.iat !== "number") {
    throw new XeroOAuthStateError("State payload missing required fields.");
  }
  if (Date.now() - payload.iat > TTL_MS) {
    throw new XeroOAuthStateError("State token expired — restart the Xero connection.");
  }
  return { orgId: payload.orgId, userId: payload.userId };
}
