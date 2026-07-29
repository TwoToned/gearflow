import { describe, test, expect, vi, beforeEach } from "vitest";

const mutationMock = vi.fn();
const queryMock = vi.fn();
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: async () => ({ mutation: mutationMock, query: queryMock }),
}));

const { validateRegistrationRequest, ClientRegistrationError, registerOauthClient, authenticateClientRequest } =
  await import("./client-registration");

describe("validateRegistrationRequest — RFC 7591 DCR body validation", () => {
  test("accepts a minimal valid public-client registration", () => {
    const result = validateRegistrationRequest({ redirect_uris: ["https://claude.ai/callback"] });
    expect(result.redirectUris).toEqual(["https://claude.ai/callback"]);
    expect(result.tokenEndpointAuthMethod).toBe("none");
  });

  test("accepts a confidential client requesting client_secret_basic", () => {
    const result = validateRegistrationRequest({
      redirect_uris: ["https://example.com/callback"],
      token_endpoint_auth_method: "client_secret_basic",
      client_name: "My Confidential Client",
    });
    expect(result.tokenEndpointAuthMethod).toBe("client_secret_basic");
    expect(result.clientName).toBe("My Confidential Client");
  });

  test("rejects a missing/empty redirect_uris array", () => {
    expect(() => validateRegistrationRequest({ redirect_uris: [] })).toThrow(ClientRegistrationError);
    expect(() => validateRegistrationRequest({})).toThrow(ClientRegistrationError);
  });

  test("rejects a plain-http (non-loopback) redirect URI", () => {
    expect(() => validateRegistrationRequest({ redirect_uris: ["http://evil.example.com/callback"] })).toThrow(
      ClientRegistrationError,
    );
  });

  test("allows a loopback redirect URI (native/CLI clients)", () => {
    const result = validateRegistrationRequest({ redirect_uris: ["http://127.0.0.1:5555/cb"] });
    expect(result.redirectUris).toEqual(["http://127.0.0.1:5555/cb"]);
  });

  test("rejects an invalid token_endpoint_auth_method", () => {
    expect(() =>
      validateRegistrationRequest({
        redirect_uris: ["https://example.com/callback"],
        token_endpoint_auth_method: "client_secret_jwt",
      }),
    ).toThrow(ClientRegistrationError);
  });
});

describe("client_secret hashing/verification round trip", () => {
  let storedClient: { id: string; clientSecretHash?: string; tokenEndpointAuthMethod: "none" | "client_secret_basic"; redirectUris: string[] };

  beforeEach(() => {
    vi.clearAllMocks();
    mutationMock.mockImplementation(async (_fn: unknown, args: Record<string, unknown>) => {
      storedClient = {
        id: args.id as string,
        clientSecretHash: args.clientSecretHash as string | undefined,
        tokenEndpointAuthMethod: args.tokenEndpointAuthMethod as "none" | "client_secret_basic",
        redirectUris: args.redirectUris as string[],
      };
      return storedClient.id;
    });
    queryMock.mockImplementation(async () => storedClient);
  });

  test("a confidential client's secret authenticates via the registered hash, and the stored hash is salted (not a bare digest)", async () => {
    const input = validateRegistrationRequest({
      redirect_uris: ["https://example.com/callback"],
      token_endpoint_auth_method: "client_secret_basic",
    });
    const registered = await registerOauthClient(input);
    expect(registered.client_secret).toBeTruthy();
    // Salted format ("salt:derived") — never a bare fixed-length hex digest,
    // which would be the fast-unsalted-hash CodeQL flags.
    expect(storedClient.clientSecretHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);

    const form = new URLSearchParams({ client_id: registered.client_id, client_secret: registered.client_secret! });
    const result = await authenticateClientRequest(new Request("http://localhost/token") as never, form);
    expect(result).toEqual({ ok: true, client: expect.objectContaining({ id: registered.client_id }) });
  });

  test("a wrong client_secret is rejected", async () => {
    const input = validateRegistrationRequest({
      redirect_uris: ["https://example.com/callback"],
      token_endpoint_auth_method: "client_secret_basic",
    });
    const registered = await registerOauthClient(input);

    const form = new URLSearchParams({ client_id: registered.client_id, client_secret: "totally-wrong-secret" });
    const result = await authenticateClientRequest(new Request("http://localhost/token") as never, form);
    expect(result).toEqual({ ok: false, reason: "invalid_client" });
  });

  test("a public client (no secret) authenticates with no client_secret at all", async () => {
    const input = validateRegistrationRequest({ redirect_uris: ["https://claude.ai/callback"] });
    const registered = await registerOauthClient(input);
    expect(registered.client_secret).toBeUndefined();

    const form = new URLSearchParams({ client_id: registered.client_id });
    const result = await authenticateClientRequest(new Request("http://localhost/token") as never, form);
    expect(result).toEqual({ ok: true, client: expect.objectContaining({ id: registered.client_id }) });
  });
});
