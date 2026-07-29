import { describe, test, expect } from "vitest";
import { validateRegistrationRequest, ClientRegistrationError } from "./client-registration";

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
