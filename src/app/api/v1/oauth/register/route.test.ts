/**
 * `POST /api/v1/oauth/register` — RFC 7591 dynamic client registration
 * (Phase 7, #1003). Deliberately unauthenticated (a client has no credential
 * before registering).
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const mutationMock = vi.fn();
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: async () => ({ mutation: mutationMock, query: vi.fn() }),
}));

const { POST } = await import("./route");

function req(body: unknown) {
  return new Request("http://localhost/api/v1/oauth/register", {
    method: "POST",
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mutationMock.mockResolvedValue("convex_internal_id");
});

describe("POST /api/v1/oauth/register", () => {
  test("registers a public client and returns a client_id with NO client_secret", async () => {
    const res = await POST(req({ redirect_uris: ["https://claude.ai/api/mcp/callback"] }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.client_id).toBeTruthy();
    expect(body.client_secret).toBeUndefined();
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.grant_types).toEqual(["authorization_code", "refresh_token"]);
  });

  test("registers a confidential client and returns a client_secret exactly once", async () => {
    const res = await POST(
      req({
        redirect_uris: ["https://example.com/callback"],
        token_endpoint_auth_method: "client_secret_basic",
      }),
    );
    const body = await res.json();
    expect(body.client_secret).toBeTruthy();
    expect(body.token_endpoint_auth_method).toBe("client_secret_basic");
  });

  test("rejects a non-https, non-loopback redirect URI", async () => {
    const res = await POST(req({ redirect_uris: ["http://evil.example.com/callback"] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_client_metadata");
  });

  test("rejects a missing redirect_uris", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  test("rejects invalid JSON", async () => {
    const res = await POST(new Request("http://localhost/api/v1/oauth/register", { method: "POST", body: "not json" }) as never);
    expect(res.status).toBe(400);
  });
});
