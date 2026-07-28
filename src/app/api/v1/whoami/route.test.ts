/**
 * `GET /api/v1/whoami` (#998). The one property that matters here: `role` (and
 * therefore `permissions`) is read LIVE from the `members` mirror on every
 * request — never cached, never taken from the token's claims. A demotion (or
 * removal) must show up on the very next call, not after the 60s token TTL.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const mockAgent = {
  key: { id: "key_1", organizationId: "org_A", actingUserId: "user_1" },
  actor: { organizationId: "org_A", userId: "user_1", userName: "Ada", actorType: "apiKey" as const, apiKeyId: "key_1", scopes: ["asset:read", "project:read"] },
  client: { query: vi.fn(), mutation: vi.fn() },
};
type AuthResult = { ok: true; agent: typeof mockAgent } | { ok: false; response: Response };
const authenticateRoute = vi.fn<() => Promise<AuthResult>>(async () => ({ ok: true, agent: mockAgent }));
vi.mock("@/lib/api/route-auth", () => ({
  authenticateRoute: (...args: unknown[]) => authenticateRoute(...(args as [])),
}));

const queryMock = vi.fn();
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: async () => ({ query: queryMock }),
}));

const { GET } = await import("./route");

const req = () => new Request("http://localhost/api/v1/whoami") as never;

beforeEach(() => {
  vi.clearAllMocks();
  authenticateRoute.mockResolvedValue({ ok: true, agent: mockAgent });
});

describe("whoami — live role, not the token claim", () => {
  test("reflects the CURRENT role from the members mirror", async () => {
    queryMock.mockResolvedValueOnce({ role: "owner" });
    const res = await GET(req());
    const body = await res.json();
    expect(body.data.role).toBe("owner");
    expect(body.data.permissions.project).toEqual(["*"]);
  });

  test("a demotion between two calls shows up on the SECOND call immediately — no caching", async () => {
    queryMock.mockResolvedValueOnce({ role: "owner" });
    const first = await (await GET(req())).json();
    expect(first.data.role).toBe("owner");

    queryMock.mockResolvedValueOnce({ role: "viewer" });
    const second = await (await GET(req())).json();
    expect(second.data.role).toBe("viewer");
    expect(second.data.permissions).not.toEqual(first.data.permissions);
    // The member lookup was re-run, not memoised across calls.
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  test("a removed member (no member row) reports role: null — every RBAC call fails from here", async () => {
    queryMock.mockResolvedValueOnce(null);
    const body = await (await GET(req())).json();
    expect(body.data.role).toBeNull();
    expect(body.data.permissions).toEqual({});
  });

  test("scopes come from the key, independent of role", async () => {
    queryMock.mockResolvedValueOnce({ role: "member" });
    const body = await (await GET(req())).json();
    expect(body.data.scopes).toEqual(["asset:read", "project:read"]);
  });

  test("propagates the auth failure response unchanged when the bearer token is bad", async () => {
    const failure = new Response(JSON.stringify({ error: { code: "INVALID_KEY" } }), { status: 401 });
    authenticateRoute.mockResolvedValueOnce({ ok: false, response: failure });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
