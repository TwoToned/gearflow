import type { ConvexHttpClient } from "convex/browser";
import { getApiKeyActorContext } from "../api-key";
import type { ActorContext } from "../actor-types";
import { createAgentConvexClient } from "./agent-client";
import type { AgentTokenKey } from "./agent-token";

/**
 * Bearer key → agent identity, the one entry point the API and MCP surfaces share.
 *
 * Two halves, deliberately kept distinct:
 *
 *   • {@link getApiKeyActorContext} (existing) validates the *credential* — the
 *     hash matches a live key, the key is active/unrevoked/unexpired, the org and
 *     acting user still exist, the org kill switch is off. Node-side, fail-fast.
 *   • The AGENT token minted from the resulting key is what actually carries
 *     authority into Convex, where the *authorization* happens: RBAC, scopes,
 *     lifecycle locks, overbooking, audit. Nothing here re-implements a gate, and
 *     nothing here is trusted to have checked one — that is the whole point of
 *     the inversion (design §3).
 *
 * Note the asymmetry that makes this safe: even if this module were wrong about
 * the key's validity, `requireAgentScope` re-reads the key document inside every
 * guarded Convex transaction and rejects a revoked/expired/re-pointed key there.
 */

export interface AgentRequestContext {
  /** The validated key, in the shape the token minter accepts. */
  key: AgentTokenKey;
  /** The same identity in the codebase's shared actor shape (audit, logging). */
  actor: ActorContext;
  /** Convex client bound to a fresh 60s agent token. Per-request; never shared. */
  client: ConvexHttpClient;
}

/**
 * Extract the raw key from an `Authorization` header. Bearer-only — there is no
 * cookie path into the API, which is what makes CSRF structurally N/A rather than
 * something to defend against (R-8.11.1).
 */
export function parseBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim());
  return match?.[1] ?? null;
}

/**
 * Resolve a raw API key to everything a request needs to act as its agent.
 * Throws `ApiKeyAuthError` (credential problems) or `AgentTokenError` (mint
 * problems); both carry stable codes the error envelope maps directly.
 */
export async function authenticateAgentRequest(
  rawToken: string,
): Promise<AgentRequestContext> {
  const actor = await getApiKeyActorContext(rawToken);
  // `actorType: "apiKey"` is guaranteed by getApiKeyActorContext, and it always
  // sets apiKeyId alongside it; assert rather than `!` so a future change to that
  // contract fails loudly here instead of minting a token with an empty `akid`.
  if (actor.actorType !== "apiKey" || !actor.apiKeyId) {
    throw new Error("Resolved actor is not an API key.");
  }
  const key: AgentTokenKey = {
    id: actor.apiKeyId,
    organizationId: actor.organizationId,
    actingUserId: actor.userId,
  };
  return { key, actor, client: await createAgentConvexClient(key) };
}
