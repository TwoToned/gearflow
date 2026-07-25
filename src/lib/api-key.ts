import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";
import { getConvexClient } from "./convex-client";
import { api } from "../../convex/_generated/api";
import type { ActorContext } from "./actor-types";

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

const KEY_PREFIX = "gf_live_";

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

/**
 * SHA-256 hex of a raw key — the only representation we persist or look up by.
 *
 * Deliberately a fast digest, not a slow password KDF (bcrypt/argon2/scrypt): `rawToken`
 * is always `generateApiKey()`'s 192-bit CSPRNG secret, never a human-chosen password, so
 * there's no low-entropy guess space for a slow hash to protect against — a fast digest is
 * the standard pattern for high-entropy API-key lookup (same approach as GitHub/Stripe/AWS
 * keys). Do not "fix" this by switching to a slow KDF; that only adds latency to every
 * API-key-authenticated request. CodeQL js/insufficient-password-hash flags this because it
 * pattern-matches "hash of a generated credential" generically — see alert #2 dismissal.
 */
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
  // Display prefix: scheme + first 6 chars of the secret, e.g. "gf_live_ab12cd".
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
 * Does `granting` cover the whole of `scope`? Unlike {@link hasScope} (which asks
 * about one concrete `resource:action`), this compares a scope STRING that may
 * itself be a wildcard — so `"*"` is only granted by `"*"`, and `"asset:*"` needs
 * `"*"` or `"asset:*"`. A malformed scope is never granted.
 */
export function isScopeGranted(granting: readonly string[], scope: string): boolean {
  if (granting.includes("*")) return true;
  if (scope === "*") return false; // only a `*` holder can grant `*`
  const [resource, action, ...rest] = scope.split(":");
  if (!resource || !action || rest.length) return false;
  return hasScope(granting, resource, action);
}

/**
 * Prevent privilege escalation through key minting: a key may never create a key
 * with scopes broader than its own.
 *
 * `orgSettings:update` is what guards `createApiKey`, so without this an agent
 * holding that one scope could mint itself a `*` key and escape every other limit
 * its operator set. Sessions are exempt — a human with the RBAC permission is
 * already bounded by their role, which is the intended authority.
 */
export function assertScopesWithinActor(
  actor: ActorContext,
  requestedScopes: readonly string[],
): void {
  if (actor.actorType !== "apiKey") return;
  const granting = actor.scopes ?? [];
  const excessive = requestedScopes.filter((s) => !isScopeGranted(granting, s));
  if (excessive.length) {
    throw new ApiKeyAuthError(
      "MISSING_SCOPE",
      `An API key cannot create a key with scopes it does not hold: ${excessive.join(", ")}.`,
      excessive[0],
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

  // ApiKey lookup is Convex-native now (by_tokenHash — the token IS the credential).
  const convex = await getConvexClient();
  const key = await convex.query(api.apiKeys.getByTokenHash, { tokenHash });

  if (!key) {
    throw new ApiKeyAuthError("INVALID_KEY", "Invalid API key.");
  }
  if (!key.isActive || key.revokedAt) {
    throw new ApiKeyAuthError("KEY_INACTIVE", "This API key has been revoked.");
  }
  // A present `expiresAt` must be finite and in the future. A non-finite stored value
  // (NaN/Infinity) is treated as expired — fail closed, never "no expiry". Absent
  // (`undefined`) means no expiry.
  if (key.expiresAt != null) {
    if (!Number.isFinite(key.expiresAt) || key.expiresAt <= Date.now()) {
      throw new ApiKeyAuthError("KEY_EXPIRED", "This API key has expired.");
    }
  }

  // Org existence + acting-user name stay on Postgres (Better-Auth `organization`
  // / `user`, which remain). The kill-switch moved to the Convex org-settings row
  // (Phase 1 inversion) — it gates ALL keys for the org instantly.
  const [org, actingUser, orgSettings] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: key.organizationId },
      select: { id: true },
    }),
    prisma.user.findUnique({
      where: { id: key.actingUserId },
      select: { name: true },
    }),
    (await getConvexClient()).query(api.orgSettings.getByOrg, {
      organizationId: key.organizationId,
    }),
  ]);
  // FAIL CLOSED: the old Postgres FK cascade auto-deleted a key when its org or acting
  // user was deleted. Convex has no cascade, so a key can outlive them — reject rather
  // than authenticate a phantom actor against a missing org/user.
  if (!org) {
    throw new ApiKeyAuthError("INVALID_KEY", "Invalid API key.");
  }
  if (orgSettings?.apiKillSwitchAt) {
    throw new ApiKeyAuthError(
      "ORG_KILL_SWITCH",
      "API access is disabled for this organization.",
    );
  }
  if (!actingUser) {
    throw new ApiKeyAuthError(
      "KEY_INACTIVE",
      "This API key's acting user no longer exists.",
    );
  }

  // Best-effort last-used stamp for observability. Never block or fail auth on it.
  convex.mutation(api.apiKeys.touchLastUsed, { id: key.id }).catch(() => {});

  return {
    organizationId: key.organizationId,
    userId: key.actingUserId,
    userName: actingUser.name || "API key",
    actorType: "apiKey",
    apiKeyId: key.id,
    scopes: parseScopes(key.scopes ?? "[]"),
  };
}
