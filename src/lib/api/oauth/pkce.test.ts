import { describe, test, expect } from "vitest";
import { computeCodeChallenge, verifyPkce, isValidCodeVerifier } from "./pkce";

describe("PKCE (RFC 7636) — S256 only, OAuth 2.1 requires it on every exchange", () => {
  test("the correct verifier for a stored challenge verifies", () => {
    const verifier = "a".repeat(43);
    const challenge = computeCodeChallenge(verifier);
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  test("a wrong verifier fails", () => {
    const challenge = computeCodeChallenge("a".repeat(43));
    expect(verifyPkce("b".repeat(43), challenge)).toBe(false);
  });

  test("a challenge of a different length never verifies (no crash on length mismatch)", () => {
    expect(verifyPkce("a".repeat(43), "short")).toBe(false);
  });

  test("isValidCodeVerifier accepts 43-128 chars of the allowed charset", () => {
    expect(isValidCodeVerifier("a".repeat(43))).toBe(true);
    expect(isValidCodeVerifier("a".repeat(128))).toBe(true);
    expect(isValidCodeVerifier("a".repeat(42))).toBe(false);
    expect(isValidCodeVerifier("a".repeat(129))).toBe(false);
    expect(isValidCodeVerifier("has spaces".padEnd(43, "a"))).toBe(false);
  });
});
