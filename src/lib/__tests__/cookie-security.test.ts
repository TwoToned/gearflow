import { describe, expect, it } from "vitest";
import { shouldUseSecureCookies } from "@/lib/cookie-security";

/**
 * POLICY.md R-8.4.5: no integration test can assert the Secure cookie flag
 * against a real prod (https) response, since the e2e harness always serves
 * over local http. This unit-tests the gating logic directly instead —
 * see e2e/harness-cookie-flags.spec.ts for the HttpOnly/SameSite assertions.
 */
describe("shouldUseSecureCookies", () => {
  it("enables Secure cookies when served over https (prod)", () => {
    expect(shouldUseSecureCookies("https://flow.rvlt.app")).toBe(true);
  });

  it("disables Secure cookies when served over http (local dev)", () => {
    expect(shouldUseSecureCookies("http://localhost:3000")).toBe(false);
  });
});
