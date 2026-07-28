import { convexServiceSigner } from "../convex-service-signer";
import {
  AGENT_KEY_CLAIM,
  AGENT_TOKEN_TTL_SECONDS,
  SERVICE_CLAIM,
  SERVICE_SUBJECT,
} from "../convex-auth-constants";

/**
 * AGENT token minting — the architectural inversion at the heart of the API/MCP
 * re-implementation (docs/designs/api-mcp-reimplementation.md §3).
 *
 * The removed 2026-07 build attached the SERVICE token to API requests: the
 * all-powerful trusted-backend identity that short-circuits `requireService`,
 * `requireOrgRead` and `requireOrgPermission` to *allow*. Every gate then had to
 * be re-implemented in Node, correctly, on every path, forever — a discipline
 * problem masquerading as a design.
 *
 * Instead we mint a short-lived token shaped exactly like a USER token:
 *
 *     sub   = apiKey.actingUserId    (the human the key acts as)
 *     orgId = apiKey.organizationId
 *     akid  = apiKey.id              ← the claim that makes it an agent
 *     svc   = ABSENT                 (never — reserved for SERVICE)
 *     exp   = now + 60s
 *
 * Everything downstream then works with zero per-operation security code: the
 * member-row RBAC lookup, actor pinning, the kill switch, lifecycle locks,
 * in-mutation overbooking checks and audit all run exactly as they do for the
 * browser — and `requireService()` *fails*, so the 597 service-only functions are
 * structurally unaddressable.
 *
 * ── The one real cost: this module can impersonate any user ──────────────────
 * Minting `sub = <arbitrary user>` is the most dangerous capability in the
 * codebase. It is contained structurally, not by convention:
 *
 *   • {@link mintAgentToken} takes an already-validated `apiKeys` document as its
 *     ONLY argument. There is no parameter through which a request body could
 *     influence `sub`, and no exported way to mint an arbitrary payload.
 *   • {@link assertAgentTokenPayload} re-checks the built payload against the key
 *     before signing — `sub` must equal `actingUserId`, `akid` must equal the
 *     key's id, `svc` must be absent, and the subject must not be the reserved
 *     service subject. It runs on every mint and is exported so the regression
 *     test can hit it with a deliberately forged payload.
 *
 * Do not add an "overrides" or "claims" parameter to anything here.
 */

/** The fields of an `apiKeys` document this module needs. Deliberately the whole
 *  validated document's relevant subset, never loose strings — see the module
 *  note on impersonation. */
export interface AgentTokenKey {
  id: string;
  organizationId: string;
  actingUserId: string;
  isActive?: boolean | null;
  revokedAt?: number | null;
  expiresAt?: number | null;
}

/** The exact claim set of an agent token. `svc` is absent by TYPE, not by luck. */
export interface AgentTokenPayload {
  sub: string;
  orgId: string;
  [AGENT_KEY_CLAIM]: string;
  exp: number;
}

export class AgentTokenError extends Error {
  constructor(
    readonly code: "KEY_INACTIVE" | "KEY_EXPIRED" | "INVALID_KEY" | "MINT_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "AgentTokenError";
  }
}

/**
 * Re-validate the key immediately before minting. This is a fail-fast copy of the
 * authoritative check — `requireAgentScope` re-reads the same row inside every
 * guarded Convex transaction, and THAT is what makes revocation instant. Minting a
 * token for a dead key would simply produce a token that fails on first use; we
 * reject earlier so the caller gets the real reason.
 */
function assertKeyUsable(key: AgentTokenKey, nowMs: number): void {
  if (!key.id || !key.organizationId || !key.actingUserId) {
    throw new AgentTokenError("INVALID_KEY", "API key document is incomplete.");
  }
  if (key.isActive === false || key.revokedAt != null) {
    throw new AgentTokenError("KEY_INACTIVE", "This API key has been revoked.");
  }
  if (key.expiresAt != null && (!Number.isFinite(key.expiresAt) || key.expiresAt <= nowMs)) {
    throw new AgentTokenError("KEY_EXPIRED", "This API key has expired.");
  }
}

/**
 * The impersonation guard. Throws unless `payload` is exactly the agent token
 * `key` is allowed to produce.
 *
 * Exported solely so `agent-token.test.ts` can call it with a hand-forged payload
 * naming a different `sub` — a permanent regression test for the single most
 * dangerous capability here (§3 "Cost / risk of the inversion"). Nothing in
 * production should call it other than {@link mintAgentToken}.
 */
export function assertAgentTokenPayload(
  payload: AgentTokenPayload,
  key: AgentTokenKey,
): void {
  if (payload.sub !== key.actingUserId) {
    throw new AgentTokenError(
      "INVALID_KEY",
      "Refusing to mint an agent token whose subject is not the key's acting user.",
    );
  }
  if (payload.sub === SERVICE_SUBJECT) {
    throw new AgentTokenError(
      "INVALID_KEY",
      "Refusing to mint an agent token for the reserved service subject.",
    );
  }
  if (payload[AGENT_KEY_CLAIM] !== key.id) {
    throw new AgentTokenError(
      "INVALID_KEY",
      "Refusing to mint an agent token whose key claim is not the key's id.",
    );
  }
  if (payload.orgId !== key.organizationId) {
    throw new AgentTokenError(
      "INVALID_KEY",
      "Refusing to mint an agent token whose org is not the key's org.",
    );
  }
  if (SERVICE_CLAIM in payload) {
    throw new AgentTokenError(
      "INVALID_KEY",
      "Refusing to mint an agent token carrying the reserved service claim.",
    );
  }
}

/**
 * Build the claim set for `key`. Pure and total — every claim is a projection of
 * the key document plus the clock, which is precisely why request input cannot
 * reach `sub`.
 */
export function buildAgentTokenPayload(
  key: AgentTokenKey,
  nowMs: number,
): AgentTokenPayload {
  return {
    sub: key.actingUserId,
    orgId: key.organizationId,
    [AGENT_KEY_CLAIM]: key.id,
    exp: Math.floor(nowMs / 1000) + AGENT_TOKEN_TTL_SECONDS,
  };
}

/**
 * Mint a 60-second AGENT token for an already-validated `apiKeys` document.
 *
 * Signed by `convexServiceSigner` — the same ES256 JWKS that signs SERVICE and
 * USER tokens, so Convex's single customJwt provider validates it with no config
 * change. Never cached: the TTL is 60s and each request re-derives the token from
 * the key it authenticated with, so there is no cross-request identity to leak
 * (unlike the process-global service token, which is deliberately cached).
 */
export async function mintAgentToken(
  key: AgentTokenKey,
  nowMs: number = Date.now(),
): Promise<string> {
  assertKeyUsable(key, nowMs);
  const payload = buildAgentTokenPayload(key, nowMs);
  assertAgentTokenPayload(payload, key);

  // better-auth's JWTPayload is an index-signature type; our payload is a closed
  // shape on purpose (that closedness is what makes `svc` absent by TYPE, not by
  // luck), so widen only here, after assertAgentTokenPayload has vetted it.
  const result = await convexServiceSigner.api.signJWT({
    body: { payload: { ...payload } as Record<string, unknown> },
  });
  const token = (result as { token?: string } | null)?.token;
  if (!token) {
    throw new AgentTokenError("MINT_FAILED", "Failed to mint Convex agent token.");
  }
  return token;
}
