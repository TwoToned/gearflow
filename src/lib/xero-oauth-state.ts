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
import { signForPurpose, verifyForPurpose } from "@/lib/hmac-purpose";

const PURPOSE = "xero-oauth-state:v1";

const TTL_MS = 10 * 60 * 1000;

interface StatePayload {
  orgId: string;
  userId: string;
  nonce: string;
  iat: number;
}

// New states are signed with the purpose-separated key (hmac-purpose.ts). A state issued
// BEFORE this change was signed with the raw secret; they live 10 minutes (TTL_MS), so the
// legacy form is accepted for one release only (delete `legacySign` and its branch after it).
function legacySign(payload: string): string {
  return crypto.createHmac("sha256", env.BETTER_AUTH_SECRET).update(payload).digest("base64url"); // codeql[js/insufficient-password-hash]
}

function sign(payload: string): string {
  return signForPurpose(PURPOSE, payload);
}

function signatureValid(payload: string, signature: string): boolean {
  if (verifyForPurpose(PURPOSE, payload, signature)) return true;
  const sigBuf = Buffer.from(signature, "base64url");
  const legacy = Buffer.from(legacySign(payload), "base64url");
  return sigBuf.length === legacy.length && crypto.timingSafeEqual(sigBuf, legacy);
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
  if (!signatureValid(encoded!, signature!)) {
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
