import { expect, test } from "@playwright/test";

/**
 * Security response headers (POLICY.md R-8.11.2). Asserts the headers configured in
 * next.config.ts are actually served — the header-assertion gate the CSP finding (#613)
 * asks for. Runs against the default e2e web server (no auth needed).
 */
test.describe("security headers", () => {
  test("login response carries the enforced + report-only CSP and hardening headers", async ({
    page,
  }) => {
    const res = await page.goto("/login");
    expect(res, "response present").not.toBeNull();
    const h = res!.headers();

    // Enforced CSP — the zero-risk subset is active (blocks object/base/framing).
    expect(h["content-security-policy"], "CSP enforced header").toBeTruthy();
    expect(h["content-security-policy"]).toContain("object-src 'none'");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"]).toContain("base-uri 'self'");

    // Full target policy is still observed in report-only.
    expect(h["content-security-policy-report-only"], "CSP report-only header").toBeTruthy();
    expect(h["content-security-policy-report-only"]).toContain("default-src 'self'");

    // Other hardening headers.
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["strict-transport-security"] ?? "").toContain("max-age=");
    expect(h["permissions-policy"] ?? "").toContain("microphone=()");
  });
});
