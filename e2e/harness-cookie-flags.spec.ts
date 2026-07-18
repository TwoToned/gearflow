import { expect, test } from "@playwright/test";

/**
 * Session cookie hardening (POLICY.md R-8.4.5): asserts the Better Auth session
 * cookie carries HttpOnly + SameSite after login. Runs against the seeded harness
 * (E2E_HARNESS=1); over http (local) the Secure flag is intentionally off
 * (useSecureCookies is gated on https) — it is verified to be present in prod separately.
 */
test.describe("harness: session cookie flags", () => {
  test.skip(!process.env.E2E_HARNESS, "requires the seeded Convex harness");

  test("session cookie is HttpOnly + SameSite", async ({ page, context }) => {
    const email = `e2e+${Date.now()}@harness.local`;
    await page.goto("/register");
    await page.getByLabel(/name/i).first().fill("Cookie Test");
    await page.getByLabel(/email/i).first().fill(email);
    await page.getByLabel(/password/i).first().fill("harness-password-123");
    await page.getByRole("button", { name: /create|register|sign up/i }).first().click();
    await expect(page).toHaveURL(/\/(dashboard|onboarding)\b/, { timeout: 20000 });

    const cookies = await context.cookies();
    const session = cookies.find((c) => /better-auth\.session_token/.test(c.name));
    expect(session, "session cookie present").toBeTruthy();
    expect(session!.httpOnly, "HttpOnly").toBe(true);
    expect(["Lax", "Strict"], "SameSite").toContain(session!.sameSite);
  });
});
