import { env } from "@/env";
import { RESOURCES, rolePermissions } from "../../../../convex/lib/permissionsCore";
import { SELF_ACTIONS, SELF_RESOURCE } from "../../../../convex/lib/scopes";

/**
 * Authorization-server + protected-resource metadata (Phase 7, #1003) — RFC
 * 8414 / RFC 9728, per the MCP authorization spec. Both `.well-known` routes
 * read from here so the two documents can't disagree about the issuer or the
 * scope vocabulary.
 */

function appUrl(): string {
  return env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
}

/** The full scope vocabulary this server understands — every `resource:action`
 *  the owner role can reach (the ceiling of every other role) plus the
 *  personal-scope pair. Advisory only (`scopes_supported` is informational
 *  per RFC 8414) — actual grants are narrowed per-user at consent time. */
function allScopesSupported(): string[] {
  const scopes = new Set<string>();
  for (const resource of RESOURCES) {
    for (const action of rolePermissions.owner[resource] ?? []) scopes.add(`${resource}:${action}`);
  }
  for (const action of SELF_ACTIONS) scopes.add(`${SELF_RESOURCE}:${action}`);
  return [...scopes].sort();
}

export function authorizationServerMetadata() {
  const issuer = appUrl();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/v1/oauth/token`,
    registration_endpoint: `${issuer}/api/v1/oauth/register`,
    revocation_endpoint: `${issuer}/api/v1/oauth/revoke`,
    scopes_supported: allScopesSupported(),
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    service_documentation: `${issuer}/llms.txt`,
  };
}

/** The MCP endpoint this server protects. */
function protectedResourceUrl(): string {
  return `${appUrl()}/api/v1/mcp`;
}

export function protectedResourceMetadata() {
  const issuer = appUrl();
  return {
    resource: protectedResourceUrl(),
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: allScopesSupported(),
  };
}

export function protectedResourceMetadataUrl(): string {
  return `${appUrl()}/.well-known/oauth-protected-resource`;
}
