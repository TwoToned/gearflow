import { describe, test, expect, vi } from "vitest";
import {
  AgentTokenError,
  assertAgentTokenPayload,
  buildAgentTokenPayload,
  type AgentTokenKey,
  type AgentTokenPayload,
} from "./agent-token";
import { AGENT_KEY_CLAIM, AGENT_TOKEN_TTL_SECONDS, SERVICE_SUBJECT } from "../convex-auth-constants";

// `convexServiceSigner` reaches for Better Auth + Prisma + env at import time, and
// none of that is needed to test the claim construction and the impersonation
// guard — which are the parts with security consequences. The signing itself is
// the same `signJWT` call the SERVICE token has used since the Phase-5 auth bridge.
vi.mock("../convex-service-signer", () => ({
  convexServiceSigner: { api: { signJWT: vi.fn(async () => ({ token: "signed" })) } },
}));

/**
 * ASSERTION 8 of #996, and the permanent regression guard for the single most
 * dangerous capability in the codebase.
 *
 * Minting `sub = <arbitrary user>` is real impersonation. The design (§3, "Cost /
 * risk of the inversion") requires that it be reachable ONLY from a validated key
 * document, never from request input. That is enforced two ways, and both are
 * tested here:
 *
 *   • structurally — `mintAgentToken` takes the key document as its only argument
 *     and derives every claim from it, so there is no parameter through which a
 *     request body could influence `sub`;
 *   • defensively — `assertAgentTokenPayload` re-checks the built payload against
 *     the key before signing, which is what these tests attack directly with
 *     hand-forged payloads.
 */

const KEY: AgentTokenKey = {
  id: "key_1",
  organizationId: "org_A",
  actingUserId: "user_1",
};
const NOW = 1_700_000_000_000;

describe("buildAgentTokenPayload", () => {
  test("every claim is a projection of the key document", () => {
    const payload = buildAgentTokenPayload(KEY, NOW);
    expect(payload.sub).toBe(KEY.actingUserId);
    expect(payload.orgId).toBe(KEY.organizationId);
    expect(payload[AGENT_KEY_CLAIM]).toBe(KEY.id);
  });

  test("the TTL is 60 seconds", () => {
    const payload = buildAgentTokenPayload(KEY, NOW);
    expect(payload.exp - Math.floor(NOW / 1000)).toBe(AGENT_TOKEN_TTL_SECONDS);
    expect(AGENT_TOKEN_TTL_SECONDS).toBe(60);
  });

  test("`svc` is never present — the claim reserved for the SERVICE identity", () => {
    // If this ever regresses, an agent token becomes the trusted backend and every
    // guard in the system opens at once. It is the highest-consequence single
    // assertion in the suite.
    const payload = buildAgentTokenPayload(KEY, NOW);
    expect("svc" in payload).toBe(false);
    expect(Object.keys(payload).sort()).toEqual(["akid", "exp", "orgId", "sub"]);
  });
});

describe("assertAgentTokenPayload — the impersonation guard", () => {
  const valid = () => buildAgentTokenPayload(KEY, NOW);

  test("accepts the payload the minter builds", () => {
    expect(() => assertAgentTokenPayload(valid(), KEY)).not.toThrow();
  });

  test("REFUSES a subject that is not the key's acting user", () => {
    const forged: AgentTokenPayload = { ...valid(), sub: "victim_user" };
    expect(() => assertAgentTokenPayload(forged, KEY)).toThrow(
      /subject is not the key's acting user/i,
    );
    expect(() => assertAgentTokenPayload(forged, KEY)).toThrow(AgentTokenError);
  });

  test("REFUSES the reserved service subject", () => {
    const forged: AgentTokenPayload = { ...valid(), sub: SERVICE_SUBJECT };
    const serviceKey: AgentTokenKey = { ...KEY, actingUserId: SERVICE_SUBJECT };
    // Even when the key document itself names the service subject — which would
    // make the "sub equals actingUserId" check pass — minting is refused.
    expect(() => assertAgentTokenPayload(forged, serviceKey)).toThrow(/reserved service subject/i);
  });

  test("REFUSES a mismatched key claim", () => {
    const forged: AgentTokenPayload = { ...valid(), [AGENT_KEY_CLAIM]: "some_other_key" };
    expect(() => assertAgentTokenPayload(forged, KEY)).toThrow(/key claim is not the key's id/i);
  });

  test("REFUSES a mismatched org", () => {
    const forged: AgentTokenPayload = { ...valid(), orgId: "org_B" };
    expect(() => assertAgentTokenPayload(forged, KEY)).toThrow(/org is not the key's org/i);
  });

  test("REFUSES a payload carrying `svc`", () => {
    const forged = { ...valid(), svc: true } as unknown as AgentTokenPayload;
    expect(() => assertAgentTokenPayload(forged, KEY)).toThrow(/reserved service claim/i);
  });
});

describe("mintAgentToken", () => {
  test("mints for a healthy key", async () => {
    const { mintAgentToken } = await import("./agent-token");
    await expect(mintAgentToken(KEY, NOW)).resolves.toBe("signed");
  });

  test("refuses a revoked key", async () => {
    const { mintAgentToken } = await import("./agent-token");
    await expect(mintAgentToken({ ...KEY, revokedAt: NOW - 1 }, NOW)).rejects.toThrow(/revoked/i);
  });

  test("refuses a deactivated key", async () => {
    const { mintAgentToken } = await import("./agent-token");
    await expect(mintAgentToken({ ...KEY, isActive: false }, NOW)).rejects.toThrow(/revoked/i);
  });

  test("refuses an expired key", async () => {
    const { mintAgentToken } = await import("./agent-token");
    await expect(mintAgentToken({ ...KEY, expiresAt: NOW - 1 }, NOW)).rejects.toThrow(/expired/i);
  });

  test("treats a non-finite expiresAt as expired — fail closed, never 'no expiry'", async () => {
    const { mintAgentToken } = await import("./agent-token");
    await expect(mintAgentToken({ ...KEY, expiresAt: NaN }, NOW)).rejects.toThrow(/expired/i);
    await expect(mintAgentToken({ ...KEY, expiresAt: Infinity }, NOW)).rejects.toThrow(/expired/i);
  });

  test("refuses an incomplete key document", async () => {
    const { mintAgentToken } = await import("./agent-token");
    await expect(
      mintAgentToken({ ...KEY, actingUserId: "" }, NOW),
    ).rejects.toThrow(/incomplete/i);
  });

  test("signs the exact payload the builder produced — no extra claims slip in", async () => {
    const { mintAgentToken } = await import("./agent-token");
    const { convexServiceSigner } = await import("../convex-service-signer");
    const signJWT = vi.mocked(convexServiceSigner.api.signJWT);
    signJWT.mockClear();

    await mintAgentToken(KEY, NOW);

    const call = signJWT.mock.calls[0]?.[0] as { body: { payload: Record<string, unknown> } };
    expect(call.body.payload).toEqual(buildAgentTokenPayload(KEY, NOW));
  });
});
