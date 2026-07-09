import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";
import type { ActorContext } from "./actor-context";

/**
 * API-key auth for the agent-accessible API + MCP layer.
 *
 * A key is an org-scoped bearer secret that acts on behalf of a user. We store
 * ONLY the SHA-256 hash (never the raw secret) plus a non-secret display prefix.
 * Resolving a key yields an {@link ActorContext} with `actorType: "apiKey"`, which
 * then flows through the exact same RBAC path as a UI session
 * (`resolvePermissionForActor`). Effective permission is the intersection of the
 * key's `scopes` (checked via {@link requireApiScope}) and the acting user's live
 * RBAC (checked via `requirePermission`).
 *
 * See docs/designs/api-mcp-agent-access.md.
 */

const KEY_PREFIX = "rvlt_live_";

/** Stable machine-readable reasons an API key can be rejected (mapped to the API error envelope). */
export type ApiKeyRejectionCode =
  | "INVALID_KEY"
  | "KEY_INACTIVE"
  | "KEY_EXPIRED"
  | "ORG_KILL_SWITCH"
  | "MISSING_SCOPE";

export class ApiKeyAuthError extends Error {
  constructor(
    public readonly code: ApiKeyRejectionCode,
    message: string,
    /** For MISSING_SCOPE: the exact scope string the caller lacked. */
    public readonly requiredScope?: string,
  ) {
    super(message);
    this.name = "ApiKeyAuthError";
  }
}

/** SHA-256 hex of a raw key — the only representation we persist or look up by. */
export function hashApiKey(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Mint a new secret. Returns the raw token (shown to the user ONCE), the
 * non-secret display `prefix`, and the `tokenHash` to persist. The full raw token
 * is `prefix` + a random secret so the prefix is a genuine substring of the key.
 */
export function generateApiKey(): {
  raw: string;
  prefix: string;
  tokenHash: string;
} {
  const secret = randomBytes(24).toString("hex");
  const raw = `${KEY_PREFIX}${secret}`;
  // Display prefix: scheme + first 6 chars of the secret, e.g. "rvlt_live_ab12cd".
  const prefix = `${KEY_PREFIX}${secret.slice(0, 6)}`;
  return { raw, prefix, tokenHash: hashApiKey(raw) };
}

/** Parse the stored `scopes` JSON string into a string[] (never throws). */
export function parseScopes(scopesJson: string): string[] {
  try {
    const parsed = JSON.parse(scopesJson);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Does this scope set grant `resource:action`? Supports `*` (all), `resource:*`
 * (all actions on a resource), and exact `resource:action`.
 */
export function hasScope(
  scopes: readonly string[],
  resource: string,
  action: string,
): boolean {
  return (
    scopes.includes("*") ||
    scopes.includes(`${resource}:*`) ||
    scopes.includes(`${resource}:${action}`)
  );
}

/**
 * Enforce the KEY-SCOPE half of the intersection. Throws `ApiKeyAuthError` with
 * `MISSING_SCOPE` if the key's scopes don't cover `resource:action`. The RBAC half
 * (does the acting user's role allow it) is enforced separately by
 * `requirePermission(resource, action, actor)`.
 */
export function requireApiScope(
  actor: ActorContext,
  resource: string,
  action: string,
): void {
  if (actor.actorType !== "apiKey") return; // sessions carry full user RBAC, unscoped
  const scopes = actor.scopes ?? [];
  if (!hasScope(scopes, resource, action)) {
    throw new ApiKeyAuthError(
      "MISSING_SCOPE",
      `This API key is missing the '${resource}:${action}' scope.`,
      `${resource}:${action}`,
    );
  }
}

/**
 * Resolve a raw bearer token to an {@link ActorContext}, or throw
 * `ApiKeyAuthError`. Validates, in order: key exists, active + not revoked, not
 * expired, and the org's kill switch is off. Best-effort updates `lastUsedAt`.
 *
 * Membership/role of the acting user is NOT checked here — that is the RBAC
 * layer's job (`requirePermission`), which runs on every guarded operation and
 * reflects the user's LIVE role. So a demoted/deactivated user is narrowed
 * immediately, without needing to touch the key.
 */
export async function getApiKeyActorContext(
  rawToken: string,
): Promise<ActorContext> {
  const tokenHash = hashApiKey(rawToken);

  const key = await prisma.apiKey.findUnique({
    where: { tokenHash },
    include: {
      actingUser: { select: { name: true } },
      organization: { select: { apiKillSwitchAt: true } },
    },
  });

  if (!key) {
    throw new ApiKeyAuthError("INVALID_KEY", "Invalid API key.");
  }
  if (!key.isActive || key.revokedAt) {
    throw new ApiKeyAuthError("KEY_INACTIVE", "This API key has been revoked.");
  }
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
    throw new ApiKeyAuthError("KEY_EXPIRED", "This API key has expired.");
  }
  if (key.organization.apiKillSwitchAt) {
    throw new ApiKeyAuthError(
      "ORG_KILL_SWITCH",
      "API access is disabled for this organization.",
    );
  }

  // Best-effort last-used stamp for observability. Never block or fail auth on it.
  prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    organizationId: key.organizationId,
    userId: key.actingUserId,
    userName: key.actingUser.name || "API key",
    actorType: "apiKey",
    apiKeyId: key.id,
    scopes: parseScopes(key.scopes),
  };
}
