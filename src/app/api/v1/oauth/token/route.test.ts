/**
 * `POST /api/v1/oauth/token` (Phase 7, #1003). Tests the ROUTE's own
 * responsibilities — form parsing, grant_type dispatch, and the
 * post-redemption cross-checks (client_id/redirect_uri/PKCE) — against mocked
 * lib functions. The underlying pieces (PKCE verification, single-use code
 * redemption, refresh-token rotation) have their own focused unit/Convex
 * tests (`pkce.test.ts`, `oauthAuthorizationCodes.test.ts`, `apiKeysOAuth.test.ts`).
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const authenticateClientRequest = vi.fn();
vi.mock("@/lib/api/oauth/client-registration", () => ({
  authenticateClientRequest: (...args: unknown[]) => authenticateClientRequest(...args),
}));

const redeemAuthorizationCode = vi.fn();
vi.mock("@/lib/api/oauth/authorization-code", () => ({
  redeemAuthorizationCode: (...args: unknown[]) => redeemAuthorizationCode(...args),
}));

const verifyPkce = vi.fn();
vi.mock("@/lib/api/oauth/pkce", () => ({
  verifyPkce: (...args: unknown[]) => verifyPkce(...args),
}));

const mintOAuthGrant = vi.fn();
const refreshOAuthGrant = vi.fn();
class RefreshGrantError extends Error {}
vi.mock("@/lib/api/oauth/grant", () => ({
  mintOAuthGrant: (...args: unknown[]) => mintOAuthGrant(...args),
  refreshOAuthGrant: (...args: unknown[]) => refreshOAuthGrant(...args),
  RefreshGrantError,
}));

const { POST } = await import("./route");

const CLIENT = { id: "client_1", clientName: "Test Client", tokenEndpointAuthMethod: "none" as const, redirectUris: ["https://x.example.com/cb"] };
const REDEEMED = {
  clientId: "client_1",
  redirectUri: "https://x.example.com/cb",
  codeChallenge: "challenge-1",
  codeChallengeMethod: "S256" as const,
  scopes: ["asset:read"],
  userId: "user_1",
  organizationId: "org_A",
  resource: null,
};

function formReq(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return new Request("http://localhost/api/v1/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticateClientRequest.mockResolvedValue({ ok: true, client: CLIENT });
  redeemAuthorizationCode.mockResolvedValue(REDEEMED);
  verifyPkce.mockReturnValue(true);
  mintOAuthGrant.mockResolvedValue({ access_token: "tok", token_type: "Bearer", expires_in: 3600, refresh_token: "ref", scope: "asset:read" });
});

describe("authorization_code grant", () => {
  test("happy path mints a token pair", async () => {
    const res = await POST(
      formReq({ grant_type: "authorization_code", code: "code-1", redirect_uri: "https://x.example.com/cb", code_verifier: "v".repeat(43) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBe("tok");
    expect(mintOAuthGrant).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_A", actingUserId: "user_1", clientId: "client_1" }),
    );
  });

  test("rejects when code_verifier is missing", async () => {
    const res = await POST(formReq({ grant_type: "authorization_code", code: "code-1", redirect_uri: "https://x.example.com/cb" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
  });

  test("a code redemption failure (reused/expired/unknown) maps to invalid_grant", async () => {
    redeemAuthorizationCode.mockResolvedValueOnce(null);
    const res = await POST(
      formReq({ grant_type: "authorization_code", code: "code-1", redirect_uri: "https://x.example.com/cb", code_verifier: "v".repeat(43) }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
    expect(mintOAuthGrant).not.toHaveBeenCalled();
  });

  test("a code issued to a DIFFERENT client is rejected even after successful redemption", async () => {
    redeemAuthorizationCode.mockResolvedValueOnce({ ...REDEEMED, clientId: "some_other_client" });
    const res = await POST(
      formReq({ grant_type: "authorization_code", code: "code-1", redirect_uri: "https://x.example.com/cb", code_verifier: "v".repeat(43) }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
    expect(mintOAuthGrant).not.toHaveBeenCalled();
  });

  test("a redirect_uri mismatch between the request and the redeemed code is rejected", async () => {
    const res = await POST(
      formReq({
        grant_type: "authorization_code",
        code: "code-1",
        redirect_uri: "https://different.example.com/cb",
        code_verifier: "v".repeat(43),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
    expect(mintOAuthGrant).not.toHaveBeenCalled();
  });

  test("a failed PKCE verification is rejected and never mints a token", async () => {
    verifyPkce.mockReturnValue(false);
    const res = await POST(
      formReq({ grant_type: "authorization_code", code: "code-1", redirect_uri: "https://x.example.com/cb", code_verifier: "wrong".repeat(10) }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
    expect(mintOAuthGrant).not.toHaveBeenCalled();
  });
});

describe("refresh_token grant", () => {
  test("happy path rotates and returns a new token pair", async () => {
    refreshOAuthGrant.mockResolvedValueOnce({ access_token: "tok2", token_type: "Bearer", expires_in: 3600, refresh_token: "ref2", scope: "asset:read" });
    const res = await POST(formReq({ grant_type: "refresh_token", refresh_token: "old-refresh" }));
    expect(res.status).toBe(200);
    expect((await res.json()).access_token).toBe("tok2");
  });

  test("an invalid/expired/revoked refresh token maps to invalid_grant", async () => {
    refreshOAuthGrant.mockRejectedValueOnce(new RefreshGrantError("dead"));
    const res = await POST(formReq({ grant_type: "refresh_token", refresh_token: "dead-refresh" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
  });
});

describe("request-shape validation", () => {
  test("rejects an unsupported grant_type (no implicit flow, ever)", async () => {
    const res = await POST(formReq({ grant_type: "implicit" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unsupported_grant_type");
  });

  test("rejects when client authentication fails", async () => {
    authenticateClientRequest.mockResolvedValueOnce({ ok: false, reason: "invalid_client" });
    const res = await POST(formReq({ grant_type: "refresh_token", refresh_token: "x", client_id: "unknown" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid_client");
  });
});
