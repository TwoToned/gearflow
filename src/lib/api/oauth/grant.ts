import { randomBytes } from "crypto";
import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "../../convex-client";
import { api } from "../../../../convex/_generated/api";
import { prisma } from "../../prisma";
import { hashApiKey } from "../../api-key";
import { logActivity } from "../../activity-log";
import {
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_REFRESH_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
} from "./constants";

/**
 * OAuth token minting (Phase 7, #1003) — the token-exchange half of "OAuth is a
 * pure auth adapter in front of the Phase 3 dispatcher" (design §14). An
 * OAuth-issued access token is nothing more than an `apiKeys` row's raw
 * secret: it flows through `getApiKeyActorContext` -> `mintAgentToken` exactly
 * like a manually-minted bearer key, so every gate downstream (RBAC, scopes,
 * lifecycle locks, kill switch, audit) applies with zero new code.
 */

export interface OAuthTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

function mintSecret(prefix: string): { raw: string; hash: string } {
  const raw = `${prefix}${randomBytes(24).toString("hex")}`;
  return { raw, hash: hashApiKey(raw) };
}

/** Display prefix mirrors `generateApiKey()`'s convention (scheme + first 6
 *  secret chars) so an OAuth grant shows up the same way a manual key does in
 *  the settings UI. */
function displayPrefix(raw: string, schemeLength: number): string {
  return raw.slice(0, schemeLength + 6);
}

/**
 * Mint a brand-new grant (one `apiKeys` row per authorization-code redemption
 * — each authorization is its own individually-revocable grant record).
 */
export async function mintOAuthGrant(input: {
  organizationId: string;
  actingUserId: string;
  createdById: string;
  clientId: string;
  clientName?: string;
  scopes: string[];
  name?: string;
}): Promise<OAuthTokenResponse> {
  const now = Date.now();
  const id = createId();
  const access = mintSecret(OAUTH_ACCESS_TOKEN_PREFIX);
  const refresh = mintSecret(OAUTH_REFRESH_TOKEN_PREFIX);
  const accessTokenExpiresAt = now + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000;
  const refreshTokenExpiresAt = now + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000;

  const convex = await getConvexClient();
  await convex.mutation(api.apiKeys.mintOAuthGrant, {
    id,
    organizationId: input.organizationId,
    name: input.name ?? `OAuth: ${input.clientName ?? input.clientId}`,
    prefix: displayPrefix(access.raw, OAUTH_ACCESS_TOKEN_PREFIX.length),
    tokenHash: access.hash,
    scopes: JSON.stringify(input.scopes),
    isActive: true,
    actingUserId: input.actingUserId,
    createdById: input.createdById,
    expiresAt: accessTokenExpiresAt,
    createdAt: now,
    origin: "oauth",
    oauthClientId: input.clientId,
    refreshTokenHash: refresh.hash,
    refreshTokenExpiresAt,
  });

  const actingUser = await prisma.user.findUnique({ where: { id: input.actingUserId }, select: { name: true } });
  await logActivity({
    organizationId: input.organizationId,
    userId: input.actingUserId,
    userName: actingUser?.name || "Unknown",
    action: "create",
    entityType: "apiKey",
    entityId: id,
    entityName: input.name ?? `OAuth: ${input.clientName ?? input.clientId}`,
    summary: `Connected OAuth client "${input.clientName ?? input.clientId}"`,
    metadata: { scopes: input.scopes, oauthClientId: input.clientId, origin: "oauth" },
  });

  return {
    access_token: access.raw,
    token_type: "Bearer",
    expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refresh.raw,
    scope: input.scopes.join(" "),
  };
}

export class RefreshGrantError extends Error {}

/** Exchange a refresh token for a fresh access/refresh pair (rotation,
 *  single-use — see `apiKeys.rotateOAuthTokens`'s doc comment). */
export async function refreshOAuthGrant(rawRefreshToken: string): Promise<OAuthTokenResponse> {
  const convex = await getConvexClient();
  const presentedHash = hashApiKey(rawRefreshToken);
  const key = await convex.query(api.apiKeys.getByRefreshTokenHash, { refreshTokenHash: presentedHash });
  if (!key) throw new RefreshGrantError("Refresh token not recognised.");

  const now = Date.now();
  const access = mintSecret(OAUTH_ACCESS_TOKEN_PREFIX);
  const refresh = mintSecret(OAUTH_REFRESH_TOKEN_PREFIX);

  let rotated: { id: string; name: string; scopes: string };
  try {
    rotated = await convex.mutation(api.apiKeys.rotateOAuthTokens, {
      id: key.id,
      organizationId: key.organizationId,
      presentedRefreshTokenHash: presentedHash,
      tokenHash: access.hash,
      prefix: displayPrefix(access.raw, OAUTH_ACCESS_TOKEN_PREFIX.length),
      accessTokenExpiresAt: now + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000,
      refreshTokenHash: refresh.hash,
      refreshTokenExpiresAt: now + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
  } catch {
    throw new RefreshGrantError("Refresh token is invalid, expired, or the grant was revoked.");
  }

  return {
    access_token: access.raw,
    token_type: "Bearer",
    expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refresh.raw,
    scope: JSON.parse(rotated.scopes || "[]").join(" "),
  };
}
