import { randomBytes, createHash } from "crypto";
import { getConvexClient } from "../../convex-client";
import { api } from "../../../../convex/_generated/api";
import { AUTH_CODE_TTL_SECONDS } from "./constants";

/** SHA-256 hex — the code is a CSPRNG secret, same fast-digest posture as
 *  `hashApiKey` (never a human-chosen value). */
function hashCode(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface RedeemedCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  scopes: string[];
  userId: string;
  organizationId: string;
  resource: string | null;
}

/** Issue a new authorization code. Returns the raw code (goes in the redirect
 *  URI's `code` param) — only its hash is ever persisted. */
export async function createAuthorizationCode(input: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  userId: string;
  organizationId: string;
  resource?: string | null;
}): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const now = Date.now();
  const convex = await getConvexClient();
  await convex.mutation(api.oauthAuthorizationCodes.create, {
    codeHash: hashCode(raw),
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: "S256",
    scopes: JSON.stringify(input.scopes),
    userId: input.userId,
    organizationId: input.organizationId,
    resource: input.resource ?? undefined,
    expiresAt: now + AUTH_CODE_TTL_SECONDS * 1000,
    createdAt: now,
  });
  return raw;
}

/** Redeem a raw code exactly once. Returns `null` for missing/expired/reused —
 *  the token endpoint maps any of those to the single `invalid_grant` error
 *  (RFC 6749 §5.2 deliberately doesn't distinguish the reasons to a caller). */
export async function redeemAuthorizationCode(rawCode: string): Promise<RedeemedCode | null> {
  const convex = await getConvexClient();
  const result = await convex.mutation(api.oauthAuthorizationCodes.redeem, {
    codeHash: hashCode(rawCode),
    now: Date.now(),
  });
  if (!result) return null;
  return {
    clientId: result.clientId,
    redirectUri: result.redirectUri,
    codeChallenge: result.codeChallenge,
    codeChallengeMethod: result.codeChallengeMethod as "S256",
    scopes: JSON.parse(result.scopes || "[]"),
    userId: result.userId,
    organizationId: result.organizationId,
    resource: result.resource,
  };
}
