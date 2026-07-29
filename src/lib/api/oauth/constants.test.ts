import { describe, test, expect } from "vitest";
import { isAllowedRedirectUri } from "./constants";

describe("isAllowedRedirectUri — DCR registration + redirect_uri allowlist rule", () => {
  test("https URIs are allowed", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/callback")).toBe(true);
  });

  test("loopback http URIs are allowed (native/CLI clients)", () => {
    expect(isAllowedRedirectUri("http://127.0.0.1:33418/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:8080/callback")).toBe(true);
  });

  test("plain http to a non-loopback host is rejected", () => {
    expect(isAllowedRedirectUri("http://example.com/callback")).toBe(false);
  });

  test("other schemes are rejected", () => {
    expect(isAllowedRedirectUri("ftp://example.com/callback")).toBe(false);
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
  });

  test("malformed URIs are rejected, not thrown", () => {
    expect(isAllowedRedirectUri("not a url")).toBe(false);
    expect(isAllowedRedirectUri("")).toBe(false);
  });
});
