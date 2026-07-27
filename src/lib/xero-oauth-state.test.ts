import { describe, it, expect, vi } from "vitest";
import { createXeroOAuthState, verifyXeroOAuthState, XeroOAuthStateError } from "./xero-oauth-state";

describe("Xero OAuth state token", () => {
  it("round-trips orgId/userId through create + verify", () => {
    const token = createXeroOAuthState("org_1", "user_1");
    const decoded = verifyXeroOAuthState(token);
    expect(decoded).toEqual({ orgId: "org_1", userId: "user_1" });
  });

  it("rejects a tampered payload", () => {
    const token = createXeroOAuthState("org_1", "user_1");
    const [encoded, sig] = token.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ orgId: "org_evil", userId: "user_1", nonce: "x", iat: Date.now() })).toString("base64url");
    expect(() => verifyXeroOAuthState(`${tamperedPayload}.${sig}`)).toThrow(XeroOAuthStateError);
    void encoded;
  });

  it("rejects a tampered signature", () => {
    const token = createXeroOAuthState("org_1", "user_1");
    const [encoded] = token.split(".");
    expect(() => verifyXeroOAuthState(`${encoded}.not-a-real-signature`)).toThrow(XeroOAuthStateError);
  });

  it("rejects a malformed token (wrong number of parts)", () => {
    expect(() => verifyXeroOAuthState("just-one-part")).toThrow(XeroOAuthStateError);
    expect(() => verifyXeroOAuthState("a.b.c")).toThrow(XeroOAuthStateError);
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const token = createXeroOAuthState("org_1", "user_1");
      vi.setSystemTime(new Date("2026-01-01T00:11:00Z")); // 11 min later, TTL is 10
      expect(() => verifyXeroOAuthState(token)).toThrow(/expired/i);
    } finally {
      vi.useRealTimers();
    }
  });
});
