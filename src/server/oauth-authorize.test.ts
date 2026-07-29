import { describe, test, expect, vi, beforeEach } from "vitest";

const loadOauthClient = vi.fn();
vi.mock("@/lib/api/oauth/client-registration", () => ({
  loadOauthClient: (...args: unknown[]) => loadOauthClient(...args),
}));

vi.mock("@/lib/auth-server", () => ({
  requireOrganization: async () => ({ session: { user: { id: "user_1" } }, organizationId: "org_A" }),
}));

vi.mock("@/lib/org-context", () => ({
  getCurrentRole: async () => "owner",
}));

const { loadAuthorizeContext } = await import("./oauth-authorize");

const VALID_CLIENT = {
  id: "client_1",
  clientName: "Test Client",
  redirectUris: ["https://example.com/cb"],
  tokenEndpointAuthMethod: "none" as const,
};

const VALID_PARAMS = {
  response_type: "code",
  client_id: "client_1",
  redirect_uri: "https://example.com/cb",
  scope: "asset:read",
  state: "xyz",
  code_challenge: "a".repeat(43),
  code_challenge_method: "S256",
};

beforeEach(() => {
  vi.clearAllMocks();
  loadOauthClient.mockResolvedValue(VALID_CLIENT);
});

describe("loadAuthorizeContext — the query-param allowlist (CodeQL: property injection hardening)", () => {
  test("a crafted rawParams carrying a literal OWN '__proto__' key never reaches global Object.prototype", async () => {
    // A `{ __proto__: ... }` object LITERAL or `obj["__proto__"] = ...` bracket
    // assignment both invoke the inherited `__proto__` accessor rather than
    // creating an own property, so they can't reproduce the real attack shape.
    // `Object.fromEntries` bypasses that accessor (CreateDataPropertyOrThrow,
    // not [[Set]]) — the same mechanism `JSON.parse`-sourced query objects use —
    // which is what makes this a faithful reproduction of the vulnerable shape.
    const malicious: Record<string, string> = {
      ...VALID_PARAMS,
      ...Object.fromEntries([["__proto__", JSON.stringify({ polluted: true })]]),
    };
    expect(Object.prototype.hasOwnProperty.call(malicious, "__proto__")).toBe(true); // sanity: attack shape is real

    const result = await loadAuthorizeContext(malicious as never);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.client.id).toBe("client_1");
      expect(result.data.query.redirect_uri).toBe("https://example.com/cb");
    }
    // The actual property under test: global Object.prototype was never touched.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("rejects a request missing required params", async () => {
    const result = await loadAuthorizeContext({ response_type: "code" });
    expect(result.ok).toBe(false);
  });

  test("rejects an unregistered redirect_uri without ever redirecting to it", async () => {
    const result = await loadAuthorizeContext({ ...VALID_PARAMS, redirect_uri: "https://not-registered.example.com/cb" });
    expect(result.ok).toBe(false);
  });

  test("rejects an unknown client_id", async () => {
    loadOauthClient.mockResolvedValueOnce(null);
    const result = await loadAuthorizeContext(VALID_PARAMS);
    expect(result.ok).toBe(false);
  });
});
